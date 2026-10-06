// Claude connector (MCP over Streamable HTTP) — the tools behind
// POST /api/glowtape/mcp/{token} (route in mcp.pb.js).
//
// Who it acts as: the user who owns the connector link. Reads and most writes
// go back through Glow Tape's OWN API with that user's auth token, so every
// collection rule, the archive guard and the email/push hooks apply exactly as
// if they'd tapped it in the app — the connector can never see or do more than
// that person can. Events are the one special case: add_events creates a whole
// imported calendar with ONE digest email (the app's route sends one email per
// title), and edits go through /api/glowtape/events/update like the app's.
//
// Glow Tape itself has no AI: this only lets the user's own Claude read and
// write their show on their behalf.

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

// collection -> filter expression that ties a row to a production
const SCOPE = {
  members: "production",
  events: "production",
  conflicts: "production",
  channels: "production",
  announcements: "production",
  tasks: "production",
  tracker_items: "production",
  auditions: "production",
  resources: "production",
  notes: "production",
  units: "production",
  cast_drafts: "production",
  groups: "production",
  annotations: "production",
  line_notes: "production",
  show_reports: "production",
  timeline_templates: "production",
  slots: "production",
  bring_items: "production",
  messages: "channel.production",
  reactions: "message.channel.production",
  acks: "event.production",
  attendance: "event.production",
  announcement_acks: "announcement.production",
};

// Generic create/update/delete. Events are excluded from create/update on
// purpose (gotcha #9): use add_events / update_events / set_event_status.
const WRITABLE = [
  "members", "conflicts", "channels", "messages", "announcements", "tasks",
  "tracker_items", "resources", "notes", "units", "cast_drafts", "groups",
  "line_notes", "show_reports", "timeline_templates", "slots", "bring_items",
  "attendance",
];

const TIMELINE_SCHEMA = {
  type: "array",
  description: "Run of show: ordered rows {title, minutes} (max 40; minutes 0–600 whole numbers; title ≤200 chars). Clock times are NOT stored — they count forward from the event start, so a 0-minute row is a marker like 'Curtain up'. Send [] or null to clear.",
  items: {
    type: "object",
    properties: { title: { type: "string" }, minutes: { type: "integer", minimum: 0, maximum: 600 } },
    required: ["title", "minutes"],
  },
  maxItems: 40,
};

const COLLECTIONS = Object.keys(SCOPE);

// lib.cleanTimeline with the event named in the message.
function timelineFor(value, label, lib) {
  try {
    return lib.cleanTimeline(value);
  } catch (err) {
    throw new Error(`${label}: ${err && err.message ? err.message : err}`);
  }
}

function selfUrl() {
  return $os.getenv("GLOWTAPE_SELF_URL") || "http://127.0.0.1:8090";
}

// Look up the user for a connector secret. Returns null when unknown.
function userForToken(app, token) {
  if (!token || token.length < 30) return null;
  let row;
  try {
    row = app.findFirstRecordByFilter("mcp_tokens", "tokenHash = {:h}", { h: $security.sha256(token) });
  } catch {
    return null;
  }
  try {
    row.set("lastUsed", new Date().toISOString().replace("T", " "));
    app.save(row);
  } catch {
    /* bookkeeping only */
  }
  try {
    return app.findRecordById("users", row.get("user"));
  } catch {
    return null;
  }
}

// Call Glow Tape's own API as the connector's user.
function api(ctx, method, path, body) {
  const res = $http.send({
    url: selfUrl() + path,
    method: method,
    body: body === undefined ? "" : JSON.stringify(body),
    headers: { "content-type": "application/json", authorization: ctx.authToken },
    timeout: 60,
  });
  const data = res.json;
  if (res.statusCode >= 400) {
    const msg = (data && data.message) || `HTTP ${res.statusCode}`;
    const detail = data && data.data && Object.keys(data.data).length ? " " + JSON.stringify(data.data) : "";
    throw new Error(msg + detail);
  }
  return data;
}

function q(v) {
  return encodeURIComponent(String(v));
}

function clean(rec) {
  if (!rec || typeof rec !== "object") return rec;
  const out = {};
  for (const k of Object.keys(rec)) {
    if (k === "collectionId" || k === "collectionName") continue;
    out[k] = rec[k];
  }
  return out;
}

function needString(args, key) {
  const v = args[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`"${key}" is required.`);
  return v.trim();
}

function needCollection(args, list) {
  const c = needString(args, "collection");
  if (!list.includes(c)) throw new Error(`"${c}" isn't available here. Use one of: ${list.join(", ")}.`);
  return c;
}

// ISO 8601 (with offset) -> PocketBase datetime "YYYY-MM-DD HH:MM:SS.sssZ".
function pbTime(s, label) {
  const d = new Date(String(s));
  if (isNaN(d.getTime())) throw new Error(`${label} "${s}" isn't a date-time I can read. Use ISO 8601 with an offset, e.g. 2026-10-12T18:00:00-07:00.`);
  return d.toISOString().replace("T", " ");
}

function production(app, ctx, id, lib) {
  let p;
  try {
    p = app.findRecordById("productions", String(id || ""));
  } catch {
    throw new Error("Unknown production — call list_productions for ids.");
  }
  if (!lib.canManage(p, ctx.user)) throw new Error("You're not a manager of that show.");
  return p;
}

// --- tools --------------------------------------------------------------------

const TOOLS = [
  {
    name: "list_productions",
    description: "List the Glow Tape shows you can see (id, title, status, archived, join code). Start here — every other tool needs a production id.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run(app, ctx) {
      const r = api(ctx, "GET", "/api/collections/productions/records?perPage=200&sort=-created&expand=org");
      return r.items.map((p) => ({
        id: p.id, title: p.title, status: p.status, archived: !!p.archived, joinCode: p.joinCode,
        writtenBy: p.writtenBy, org: p.expand && p.expand.org ? p.expand.org.name : "",
        eventKinds: p.eventKinds, locations: p.locations,
      }));
    },
  },
  {
    name: "show_overview",
    description: "One-call summary of a show: the production record, how many rows each list has, the next 15 events, and the cast/crew roster (member ids + roles) you need when calling people to events.",
    inputSchema: { type: "object", properties: { production: { type: "string" } }, required: ["production"] },
    annotations: { readOnlyHint: true },
    run(app, ctx, args, lib) {
      const p = production(app, ctx, args.production, lib);
      const counts = {};
      for (const c of COLLECTIONS) {
        try {
          const r = api(ctx, "GET", `/api/collections/${c}/records?perPage=1&skipTotal=0&fields=id&filter=${q(`${SCOPE[c]} = '${p.id}'`)}`);
          counts[c] = r.totalItems;
        } catch {
          counts[c] = "not visible";
        }
      }
      const now = new Date().toISOString().replace("T", " ");
      const next = api(ctx, "GET", `/api/collections/events/records?perPage=15&sort=start&filter=${q(`production = '${p.id}' && start >= '${now}'`)}`);
      const roster = api(ctx, "GET", `/api/collections/members/records?perPage=500&sort=created&expand=user&filter=${q(`production = '${p.id}'`)}`);
      return {
        production: clean(api(ctx, "GET", `/api/collections/productions/records/${p.id}`)),
        counts,
        upcomingEvents: next.items.map(clean),
        roster: roster.items.map((m) => ({
          memberId: m.id, role: m.role, position: m.position, manager: !!m.manager,
          name: m.displayName || (m.expand && m.expand.user ? m.expand.user.name : "") || "(not cast yet)",
          minor: !!m.minor, groups: m.groups,
        })),
      };
    },
  },
  {
    name: "list_records",
    description: "List rows from one of a show's lists. Collections: " + COLLECTIONS.join(", ") +
      ". Optional PocketBase filter (e.g. \"status = 'needed'\" or \"start >= '2026-10-01'\"), sort (e.g. \"-created\", \"start\"), expand (relation names, comma-separated), limit (max 500), page.",
    inputSchema: {
      type: "object",
      properties: {
        production: { type: "string" },
        collection: { type: "string", enum: COLLECTIONS },
        filter: { type: "string" },
        sort: { type: "string" },
        expand: { type: "string" },
        limit: { type: "number" },
        page: { type: "number" },
      },
      required: ["production", "collection"],
    },
    annotations: { readOnlyHint: true },
    run(app, ctx, args, lib) {
      const p = production(app, ctx, args.production, lib);
      const c = needCollection(args, COLLECTIONS);
      let filter = `${SCOPE[c]} = '${p.id}'`;
      if (args.filter) filter += ` && (${args.filter})`;
      const limit = Math.min(Math.max(Number(args.limit) || 200, 1), 500);
      let path = `/api/collections/${c}/records?perPage=${limit}&page=${Math.max(Number(args.page) || 1, 1)}&filter=${q(filter)}`;
      if (args.sort) path += `&sort=${q(args.sort)}`;
      if (args.expand) path += `&expand=${q(args.expand)}`;
      const r = api(ctx, "GET", path);
      return { page: r.page, totalPages: r.totalPages, totalItems: r.totalItems, items: r.items.map(clean) };
    },
  },
  {
    name: "get_contacts",
    description: "Contact sheet for a show: names, emails and phones of members, guardians and auditioners (managers only).",
    inputSchema: { type: "object", properties: { production: { type: "string" } }, required: ["production"] },
    annotations: { readOnlyHint: true },
    run(app, ctx, args, lib) {
      const p = production(app, ctx, args.production, lib);
      return api(ctx, "GET", `/api/glowtape/contacts?production=${q(p.id)}`);
    },
  },
  {
    name: "set_member_contact",
    description: "Set the email and/or phone for a member with no Glow Tape account (a cast or crew row nobody has claimed yet). Those fields are hidden from the record tools, so update_record can't write them. Saving sends nothing, but once an email is set that person gets the show's emails (announcements, schedule changes) like everyone else. Pass an empty string to clear a field; leave a field out to keep it.",
    inputSchema: {
      type: "object",
      properties: { member: { type: "string" }, contactEmail: { type: "string" }, contactPhone: { type: "string" } },
      required: ["member"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run(app, ctx, args) {
      const body = { member: needString(args, "member") };
      if (typeof args.contactEmail === "string") body.contactEmail = args.contactEmail;
      if (typeof args.contactPhone === "string") body.contactPhone = args.contactPhone;
      if (!("contactEmail" in body) && !("contactPhone" in body)) throw new Error("Give contactEmail, contactPhone or both.");
      return api(ctx, "POST", "/api/glowtape/members/contact", body);
    },
  },
  {
    name: "add_events",
    description: "Add events to a show's schedule — e.g. a whole rehearsal calendar at once. Times are ISO 8601 WITH an offset (Pacific is -07:00 in summer, -08:00 from early November). called = member ids (empty = everyone), calledGroups = group ids. Sends ONE summary email to everyone called unless notify is false. Check list_records(events) first to avoid duplicates. Optional timeline = the event's run of show (see its schema). Max 100 per call.",
    inputSchema: {
      type: "object",
      properties: {
        production: { type: "string" },
        notify: { type: "boolean", description: "Email the cast one summary (default true)." },
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              kind: { type: "string", description: "Event type, e.g. Rehearsal, Tech, Performance (see the production's eventKinds)." },
              start: { type: "string" },
              end: { type: "string" },
              location: { type: "string" },
              notes: { type: "string" },
              calledNote: { type: "string", description: "Plain-English who's called, e.g. 'Act 1 cast'." },
              called: { type: "array", items: { type: "string" } },
              calledGroups: { type: "array", items: { type: "string" } },
              timeline: TIMELINE_SCHEMA,
            },
            required: ["title", "start"],
          },
        },
      },
      required: ["production", "events"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run(app, ctx, args, lib) {
      const p = production(app, ctx, args.production, lib);
      lib.assertNotArchived(p);
      const list = Array.isArray(args.events) ? args.events : [];
      if (list.length === 0) throw new Error("No events given.");
      if (list.length > 100) throw new Error("That's more than 100 events — split it into smaller batches.");
      // Validate everything before saving anything.
      const prepared = list.map((ev, i) => {
        const title = String(ev.title || "").trim();
        if (!title) throw new Error(`Event ${i + 1} needs a title.`);
        return {
          title,
          kind: String(ev.kind || ""),
          start: pbTime(ev.start, `Event ${i + 1} start`),
          end: ev.end ? pbTime(ev.end, `Event ${i + 1} end`) : "",
          location: String(ev.location || ""),
          notes: String(ev.notes || ""),
          calledNote: String(ev.calledNote || ""),
          called: Array.isArray(ev.called) ? ev.called.map(String) : [],
          calledGroups: Array.isArray(ev.calledGroups) ? ev.calledGroups.map(String) : [],
          timeline: timelineFor(ev.timeline, `Event ${i + 1}`, lib),
        };
      });
      const col = app.findCollectionByNameOrId("events");
      const created = [];
      app.runInTransaction((tx) => {
        for (const ev of prepared) {
          const rec = new Record(col);
          rec.set("production", p.id);
          for (const f of ["title", "kind", "start", "end", "location", "notes", "calledNote"]) rec.set(f, ev[f]);
          rec.set("called", ev.called);
          rec.set("calledGroups", ev.calledGroups);
          if (ev.timeline.length > 0) rec.set("timeline", ev.timeline);
          rec.set("status", "scheduled");
          tx.save(rec);
          created.push(rec);
        }
      });
      let emailed = false;
      if (args.notify !== false) {
        try {
          const everyone = prepared.some((ev) => ev.called.length === 0);
          const ids = everyone ? null : [].concat(...prepared.map((ev) => ev.called));
          const to = lib.recipients(app, p.id, ids);
          const items = created
            .slice()
            .sort((a, b) => String(a.get("start")).localeCompare(String(b.get("start"))))
            .map((ev) => `<li><strong>${ev.get("kind") ? ev.get("kind") + ": " : ""}${ev.get("title")}</strong> — ${lib.formatPacific(ev.get("start"))}${ev.get("location") ? " at " + ev.get("location") : ""}</li>`)
            .join("\n");
          lib.sendMail(
            app,
            to,
            created.length === 1
              ? `[${p.get("title")}] New on the schedule: ${created[0].get("title")}`
              : `[${p.get("title")}] ${created.length} new events on the schedule`,
            [
              `<h2>${created.length === 1 ? "New on the schedule" : created.length + " new events"}</h2>`,
              `<p><strong>${p.get("title")}</strong> — all times Pacific</p>`,
              `<ul>${items}</ul>`,
              `<p>Open Glow Tape to see the full schedule and tap "Got it" on each.</p>`,
            ].join("\n"),
          );
          emailed = true;
        } catch (err) {
          app.logger().error("glowtape: mcp add_events mail failed", "error", String(err));
        }
      }
      return { created: created.map((r) => ({ id: r.id, title: r.get("title"), start: String(r.get("start")) })), emailed };
    },
  },
  {
    name: "update_events",
    description: "Edit existing events (all in one show). Each item: {id, and any of title, kind, start, end, location, notes, calledNote, called, calledGroups, timeline}. Only fields you send change. Date/time/place changes reset 'Got it' acks and send ONE change digest to the people called — same as editing in the app. A timeline-only edit (the run of show) is silent: no email, no push, acks kept. timeline [] or null clears it.",
    inputSchema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              kind: { type: "string" },
              start: { type: "string", description: "ISO 8601 with an offset." },
              end: { type: "string", description: "ISO 8601 with an offset, or '' for no end." },
              location: { type: "string" },
              notes: { type: "string" },
              calledNote: { type: "string" },
              called: { type: "array", items: { type: "string" }, description: "Member ids; [] = everyone." },
              calledGroups: { type: "array", items: { type: "string" } },
              timeline: TIMELINE_SCHEMA,
            },
            required: ["id"],
          },
        },
      },
      required: ["events"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run(app, ctx, args, lib) {
      const items = (Array.isArray(args.events) ? args.events : []).map((ev, i) => {
        const out = Object.assign({}, ev);
        if (out.timeline !== undefined) out.timeline = timelineFor(out.timeline, `Event ${i + 1}`, lib);
        if (out.start !== undefined) out.start = pbTime(out.start, "start");
        if (out.end !== undefined && out.end !== "") out.end = pbTime(out.end, "end");
        return out;
      });
      return api(ctx, "POST", "/api/glowtape/events/update", { events: items });
    },
  },
  {
    name: "set_event_status",
    description: "Cancel (status 'cancelled') or restore (status 'scheduled') one event. Cancelling emails everyone who was called.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, status: { type: "string", enum: ["scheduled", "cancelled"] } },
      required: ["id", "status"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    run(app, ctx, args) {
      const status = needString(args, "status");
      if (status !== "scheduled" && status !== "cancelled") throw new Error("status must be scheduled or cancelled.");
      return clean(api(ctx, "PATCH", `/api/collections/events/records/${q(needString(args, "id"))}`, { status }));
    },
  },
  {
    name: "create_record",
    description: "Add a row to one of a show's lists (not events — use add_events). Writable: " + WRITABLE.join(", ") +
      ". Tracker rows: {tracker: props|costumes|set|light_cues|sound_cues, name, a, b, c, status, notes}. Tasks: {title, department, assignee(member id), due}. The production field is filled in for you. Announcements and task assignments email people, like the app.",
    inputSchema: {
      type: "object",
      properties: { production: { type: "string" }, collection: { type: "string", enum: WRITABLE }, data: { type: "object" } },
      required: ["production", "collection", "data"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run(app, ctx, args, lib) {
      const p = production(app, ctx, args.production, lib);
      const c = needCollection(args, WRITABLE);
      const data = Object.assign({}, args.data || {});
      if (SCOPE[c] === "production") data.production = p.id;
      if (c === "messages" || c === "announcements" || c === "notes" || c === "line_notes" || c === "show_reports") {
        data.author = ctx.user.id;
      }
      return clean(api(ctx, "POST", `/api/collections/${c}/records`, data));
    },
  },
  {
    name: "update_record",
    description: "Change fields on one row (not events — use update_events). Writable: " + WRITABLE.join(", ") + ".",
    inputSchema: {
      type: "object",
      properties: { collection: { type: "string", enum: WRITABLE }, id: { type: "string" }, data: { type: "object" } },
      required: ["collection", "id", "data"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run(app, ctx, args) {
      const c = needCollection(args, WRITABLE);
      const data = Object.assign({}, args.data || {});
      delete data.production;
      return clean(api(ctx, "PATCH", `/api/collections/${c}/records/${q(needString(args, "id"))}`, data));
    },
  },
  {
    name: "delete_record",
    description: "Delete one row for good (events included). Prefer set_event_status to cancel an event the cast already knows about. Deletable: " + WRITABLE.concat(["events"]).join(", ") + ".",
    inputSchema: {
      type: "object",
      properties: { collection: { type: "string", enum: WRITABLE.concat(["events"]) }, id: { type: "string" } },
      required: ["collection", "id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    run(app, ctx, args) {
      const c = needCollection(args, WRITABLE.concat(["events"]));
      api(ctx, "DELETE", `/api/collections/${c}/records/${q(needString(args, "id"))}`);
      return { deleted: true };
    },
  },
];

// --- JSON-RPC -------------------------------------------------------------------

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } };
}

// Returns the JSON-RPC response object, or null for notifications.
function handle(app, user, msg, lib) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg && msg.id, -32600, "Invalid request");
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const params = msg.params || {};
  if (isNotification) return null;

  if (msg.method === "initialize") {
    const asked = String(params.protocolVersion || "");
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "glowtape", title: "Glow Tape", version: "1.0.0" },
        instructions:
          "Glow Tape is a community-theater production manager. Call list_productions first. Times are stored in UTC and shown Pacific; always send ISO 8601 with an offset. Before adding events, read the existing schedule to avoid duplicates and confirm the list with the user. Writes email the cast the same way the app does.",
      },
    };
  }
  if (msg.method === "ping") return { jsonrpc: "2.0", id: msg.id, result: {} };
  if (msg.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) },
    };
  }
  if (msg.method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${params.name}`);
    const ctx = { user, authToken: user.newAuthToken() };
    try {
      const out = tool.run(app, ctx, params.arguments || {}, lib);
      let text = JSON.stringify(out, null, 1);
      if (text.length > 200000) text = text.slice(0, 200000) + "\n… (cut off — use filters, limit or page)";
      return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text }] } };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { isError: true, content: [{ type: "text", text: String((err && err.message) || err) }] },
      };
    }
  }
  return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
}

module.exports = { handle, userForToken, TOOLS };

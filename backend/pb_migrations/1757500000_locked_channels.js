/// <reference path="../pb_data/types.d.ts" />
//
// Channel privacy, for real this time.
//
// The pilot's cast/crew/team channel audiences were filtered only in the UI —
// the server let every production member read (and get push previews of)
// every plain channel, "Production Team" included. This migration makes the
// locks real:
//
// - groups grow an `auto` marker ('cast' | 'crew'): system groups whose
//   membership syncs from member roles (glowtape_lib.syncMemberAutoGroups).
// - Every production gets Cast/Crew auto groups; existing groups with those
//   names are adopted rather than duplicated. Performer/crew members are
//   assigned in.
// - Channels with audience 'cast'/'crew' become 🔒 group channels on those
//   auto groups — the same server-enforced gates group channels always had
//   (which also fixes guardians of cast kids being wrongly hidden from Cast).
// - audience 'team' stays, now enforced by rule: managers only. The select
//   narrows to ["all", "team"] so unenforceable audiences can't come back.
// - channels/messages/reactions rules are REWRITTEN with the team gate
//   layered in. Per the standing caveat, the operator ("Stagehand") clauses
//   from 1757400000 are re-applied here.

const OP = "@request.auth.operator = true";

// --- channels ---
const chMemberGate =
  "(member = '' || member.user = @request.auth.id || member.guardians.id ?= @request.auth.id || production.managers.id ?= @request.auth.id)";
const chGroupGate =
  "(group = '' || group.members_via_groups.user ?= @request.auth.id || group.members_via_groups.guardians.id ?= @request.auth.id || production.managers.id ?= @request.auth.id)";
const chBase =
  "(production = '' || production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id) && " +
  chMemberGate + " && " + chGroupGate;
const chTeamGate = "(audience != 'team' || production.managers.id ?= @request.auth.id)";

// --- messages ---
const msgMemberGate =
  "(channel.member = '' || channel.member.user = @request.auth.id || channel.member.guardians.id ?= @request.auth.id || channel.production.managers.id ?= @request.auth.id)";
const msgGroupGate =
  "(channel.group = '' || channel.group.members_via_groups.user ?= @request.auth.id || channel.group.members_via_groups.guardians.id ?= @request.auth.id || channel.production.managers.id ?= @request.auth.id)";
const msgBase =
  "(channel.production = '' || channel.production.managers.id ?= @request.auth.id || channel.production.members_via_production.user ?= @request.auth.id) && " +
  msgMemberGate + " && " + msgGroupGate;
const msgCreateBase =
  "author = @request.auth.id && (channel.production = '' || channel.production.members_via_production.user ?= @request.auth.id || channel.production.managers.id ?= @request.auth.id) && " +
  msgMemberGate + " && " + msgGroupGate;
const msgTeamGate =
  "(channel.audience != 'team' || channel.production.managers.id ?= @request.auth.id)";

// --- reactions ---
const rxMemberGate =
  "(message.channel.member = '' || message.channel.member.user = @request.auth.id || message.channel.member.guardians.id ?= @request.auth.id || message.channel.production.managers.id ?= @request.auth.id)";
const rxGroupGate =
  "(message.channel.group = '' || message.channel.group.members_via_groups.user ?= @request.auth.id || message.channel.group.members_via_groups.guardians.id ?= @request.auth.id || message.channel.production.managers.id ?= @request.auth.id)";
const rxBase =
  "(message.channel.production = '' || message.channel.production.managers.id ?= @request.auth.id || message.channel.production.members_via_production.user ?= @request.auth.id) && " +
  rxMemberGate + " && " + rxGroupGate;
const rxCreateBase =
  "user = @request.auth.id && (message.channel.production = '' || message.channel.production.members_via_production.user ?= @request.auth.id || message.channel.production.managers.id ?= @request.auth.id) && " +
  rxMemberGate + " && " + rxGroupGate;
const rxTeamGate =
  "(message.channel.audience != 'team' || message.channel.production.managers.id ?= @request.auth.id)";

function lockName(name) {
  return name.startsWith("🔒") ? name : "🔒 " + name;
}

migrate(
  (app) => {
    // 1. groups.auto marker. Auto groups can't be deleted (the 🔒 Cast/Crew
    // channels hang off them) and the marker itself can't be edited from the
    // API — managers keep rename and normal group management.
    const groupsCol = app.findCollectionByNameOrId("groups");
    groupsCol.fields.add(
      new Field({ type: "select", name: "auto", values: ["cast", "crew"], maxSelect: 1 }),
    );
    const groupManagerWrite = "production.managers.id ?= @request.auth.id";
    groupsCol.deleteRule = `(${groupManagerWrite} && auto = '') || ${OP}`;
    groupsCol.updateRule = `(${groupManagerWrite} && (@request.body.auto:isset = false || @request.body.auto = auto)) || ${OP}`;
    app.save(groupsCol);

    // 2. Per production: auto groups, member assignments, channel conversion.
    const productions = app.findRecordsByFilter("productions", "id != ''", "", 1000, 0);
    for (const p of productions) {
      const ensureGroup = (name, auto) => {
        let g = null;
        try {
          g = app.findFirstRecordByFilter("groups", "production = {:p} && name = {:n}", {
            p: p.id,
            n: name,
          });
        } catch {
          /* none yet */
        }
        if (!g) {
          g = new Record(app.findCollectionByNameOrId("groups"));
          g.set("production", p.id);
          g.set("name", name);
          g.set("order", 0);
        }
        if (g.get("auto") !== auto) g.set("auto", auto);
        app.save(g);
        return g;
      };
      const castG = ensureGroup("Cast", "cast");
      const crewG = ensureGroup("Crew", "crew");

      const members = app.findRecordsByFilter("members", "production = {:p}", "", 1000, 0, {
        p: p.id,
      });
      for (const m of members) {
        const role = String(m.get("role"));
        const wanted = role === "performer" ? castG.id : role === "crew" ? crewG.id : "";
        if (!wanted) continue;
        const current = [];
        const raw = m.get("groups");
        if (raw) for (const v of raw) current.push(String(v));
        if (current.includes(wanted)) continue;
        current.push(wanted);
        m.set("groups", current);
        app.save(m);
      }

      const channels = app.findRecordsByFilter("channels", "production = {:p}", "", 200, 0, {
        p: p.id,
      });
      for (const c of channels) {
        const aud = String(c.get("audience"));
        if (aud === "cast" || aud === "crew") {
          c.set("group", aud === "cast" ? castG.id : crewG.id);
          c.set("audience", "all");
          c.set("name", lockName(String(c.get("name"))));
          app.save(c);
        } else if (aud === "team") {
          const locked = lockName(String(c.get("name")));
          if (locked !== c.get("name")) {
            c.set("name", locked);
            app.save(c);
          }
        }
      }
    }

    // 3. Narrow the audience select — unenforceable values can't come back.
    const channelsCol = app.findCollectionByNameOrId("channels");
    channelsCol.fields.getByName("audience").values = ["all", "team"];

    // 4. Rules: team gate in, operator clauses preserved.
    channelsCol.listRule = `(${chBase} && ${chTeamGate}) || ${OP}`;
    channelsCol.viewRule = channelsCol.listRule;
    app.save(channelsCol);

    const messages = app.findCollectionByNameOrId("messages");
    messages.listRule = `(${msgBase} && ${msgTeamGate}) || ${OP}`;
    messages.viewRule = messages.listRule;
    messages.createRule = `(${msgCreateBase} && ${msgTeamGate}) || (${OP} && author = @request.auth.id)`;
    app.save(messages);

    const reactions = app.findCollectionByNameOrId("reactions");
    reactions.listRule = `(${rxBase} && ${rxTeamGate}) || ${OP}`;
    reactions.viewRule = reactions.listRule;
    reactions.createRule = `${rxCreateBase} && ${rxTeamGate}`;
    app.save(reactions);
  },
  (app) => {
    // Rules back to the 1757400000 state (group gates + operator, no team gate).
    const channelsCol = app.findCollectionByNameOrId("channels");
    channelsCol.fields.getByName("audience").values = ["all", "cast", "crew", "team"];
    channelsCol.listRule = `(${chBase}) || ${OP}`;
    channelsCol.viewRule = channelsCol.listRule;
    app.save(channelsCol);

    const messages = app.findCollectionByNameOrId("messages");
    messages.listRule = `(${msgBase}) || ${OP}`;
    messages.viewRule = messages.listRule;
    messages.createRule = `(${msgCreateBase}) || (${OP} && author = @request.auth.id)`;
    app.save(messages);

    const reactions = app.findCollectionByNameOrId("reactions");
    reactions.listRule = `(${rxBase}) || ${OP}`;
    reactions.viewRule = reactions.listRule;
    reactions.createRule = rxCreateBase;
    app.save(reactions);

    // Channels on auto groups back to audience channels; 🔒 prefixes off.
    const chans = app.findRecordsByFilter("channels", "group != ''", "", 1000, 0);
    for (const c of chans) {
      let auto = "";
      try {
        auto = String(app.findRecordById("groups", String(c.get("group"))).get("auto") || "");
      } catch {
        /* group gone */
      }
      if (auto !== "cast" && auto !== "crew") continue;
      c.set("group", "");
      c.set("audience", auto);
      c.set("name", String(c.get("name")).replace(/^🔒\s*/, ""));
      app.save(c);
    }
    const teamChans = app.findRecordsByFilter("channels", "audience = 'team'", "", 1000, 0);
    for (const c of teamChans) {
      const plain = String(c.get("name")).replace(/^🔒\s*/, "");
      if (plain !== c.get("name")) {
        c.set("name", plain);
        app.save(c);
      }
    }

    // Auto groups stay as ordinary groups (assignments are still useful);
    // only the marker field and its rule guards go.
    const groupsCol = app.findCollectionByNameOrId("groups");
    groupsCol.fields.removeByName("auto");
    const groupManagerWrite = "production.managers.id ?= @request.auth.id";
    groupsCol.deleteRule = `(${groupManagerWrite}) || ${OP}`;
    groupsCol.updateRule = groupsCol.deleteRule;
    app.save(groupsCol);
  },
);

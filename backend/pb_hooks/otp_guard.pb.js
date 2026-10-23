/// <reference path="../pb_data/types.d.ts" />
//
// Emailed sign-in codes live 2 hours (migration 1758900000) because slow
// inboxes were delivering them after they expired. PocketBase doesn't limit
// guesses per code, so this does: after 5 tries on one code it's deleted and
// the person asks for a new one. A right answer consumes the code anyway, so
// counting every try (right or wrong) is enough. Counts live in the app
// store — a restart resets them, which only ever helps the real person.

routerUse((e) => {
  if (e.request.method !== "POST" || e.request.url.path !== "/api/collections/users/auth-with-otp") {
    return e.next();
  }
  const otpId = String((e.requestInfo().body || {}).otpId || "");
  if (otpId) {
    const key = "otpTries:" + otpId;
    const tries = Number(e.app.store().get(key) || 0) + 1;
    if (tries > 5) {
      e.app.store().remove(key);
      try {
        e.app.delete(e.app.findOTPById(otpId));
      } catch {
        /* already gone */
      }
      throw new BadRequestError("Too many wrong tries for that code. Ask for a new one.");
    }
    e.app.store().set(key, tries);
  }
  return e.next();
});

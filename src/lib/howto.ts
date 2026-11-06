// The how-to video series (public/videos/). GENERATED from the video build
// specs — the files are made outside the repo (narrated in Steven's voice,
// subtitles burned in), so keep slugs in step with the files in public/videos/.
// Core videos (not bonus, not for-managers) make up the "Watch the how-to
// videos" Getting settled step; users.videosSeen holds the slugs watched.
export interface HowToVideo {
  slug: string
  title: string
  bonus: boolean
  managers: boolean
  seconds: number
  blurb: string
  transcript: string[]
}

export const HOWTO_VIDEOS: HowToVideo[] = [
  {
    "slug": "1-sign-in-and-join",
    "title": "Sign in & join your show",
    "bonus": false,
    "managers": false,
    "seconds": 81,
    "blurb": "Make your account with the code from your director and find your show.",
    "transcript": [
      "Welcome to Glow Tape, the free app for your show. Let's get you signed in. It takes about a minute.",
      "On your phone, go to glowtape.net. There's no password to make up. Ever.",
      "Type your name and your email address.",
      "Tap your age range, then type the code your director gave you. That code puts you right into your show.",
      "Tap Email me a sign-in code.",
      "A 6-digit code lands in your inbox from callboard@glowtape.net. Type it in, tap Sign in, and you're in. Can't find it? Check your spam folder.",
      "Your shows live on your Home page. Tap your show to open it.",
      "Got a code for another show later? Open Join a production, type it in, and tap Join.",
      "Every show opens on the Dashboard, with the countdown to opening night.",
      "Your next call is right there, with the place and time. Tap Got it so your stage manager knows you've seen it.",
      "The Getting settled list walks you through the rest. So do the next videos.",
      "And the menu button, top left, takes you anywhere: the schedule, messages, docs, and your settings.",
      "Next up: putting Glow Tape on your home screen."
    ]
  },
  {
    "slug": "2-home-screen",
    "title": "Put it on your home screen",
    "bonus": false,
    "managers": false,
    "seconds": 62,
    "blurb": "Put Glow Tape on your home screen like an app. On iPhone it’s needed for notifications.",
    "transcript": [
      "Glow Tape is handier as an icon on your home screen. On iPhone, it's the only way to get notifications.",
      "You can do this before you even sign in. The steps are right on the sign-in page.",
      "Tap Put Glow Tape on your home screen and it shows the steps for your phone.",
      "On iPhone, open glowtape.net in Safari. Not inside Facebook or Gmail. Safari.",
      "Tap the Share button, the square with the arrow. On newer iPhones it's behind the three dots at the bottom right.",
      "Scroll down, tap Add to Home Screen, then tap Add. Don't see it? Tap View More at the bottom.",
      "Now open Glow Tape from its new icon. Use the icon from here on.",
      "On Android, open it in Chrome, tap the three-dot menu, then Add to Home screen, or Install app.",
      "Next up: turning on notifications."
    ]
  },
  {
    "slug": "3-notifications",
    "title": "Turn on notifications",
    "bonus": false,
    "managers": false,
    "seconds": 60,
    "blurb": "Turn on notifications and pick when reminders arrive.",
    "transcript": [
      "Let Glow Tape tap you on the shoulder: new messages, schedule changes, and reminders.",
      "On iPhone, open Glow Tape from your home-screen icon first. Then tap Menu.",
      "Under You, tap My settings.",
      "In Notifications, tap Turn on notifications.",
      "Your phone asks for permission. Tap Allow.",
      "That's it. It's per device, so do it on each phone or computer you use.",
      "Now messages and schedule changes arrive like any other app. Too chatty? Mute a channel from Messages.",
      "Right below, When to remind me sets your reminder times. 10 hours and 2 hours before is the default.",
      "Tap up to three, like the night before. Nothing ever arrives between 9pm and 7am.",
      "Next up: getting text reminders."
    ]
  },
  {
    "slug": "4-text-reminders",
    "title": "Get text reminders",
    "bonus": false,
    "managers": false,
    "seconds": 50,
    "blurb": "Get reminder texts before each call, and sign in by text.",
    "transcript": [
      "Rather get a text? Glow Tape can text you before each call, and with urgent news.",
      "In My settings, open Text reminders.",
      "Type your cell number and tap Text me a code.",
      "A 6-digit code arrives by text.",
      "Type it in and tap Verify.",
      "Your number is verified and the box is checked. Uncheck it any time to stop the texts.",
      "You get at most two texts per rehearsal day, at the times you picked, and never late at night. Reply STOP any time.",
      "Bonus: once your number is verified, you can sign in with Text me a code instead of email.",
      "Next up: putting rehearsals on your calendar."
    ]
  },
  {
    "slug": "5-calendar",
    "title": "Put rehearsals on your calendar",
    "bonus": false,
    "managers": false,
    "seconds": 60,
    "blurb": "Put every call you’re in on Google, Apple, or any calendar, kept up to date.",
    "transcript": [
      "Want rehearsals in the calendar you already use? There are two ways.",
      "Open your show's Schedule and tap a week to open it.",
      "Tap an event to see the details.",
      "To add just that one, tap + Google Calendar,",
      "or + Apple, or other calendar.",
      "Better yet, add everything at once. At the bottom of the Schedule, tap Get my calendar link.",
      "Tap Copy.",
      "In Google Calendar, choose Other calendars, +, From URL, and paste. On iPhone, go to Settings, Calendar, Accounts, Add Account, Other, Add Subscribed Calendar.",
      "Every call you're in shows up, and it updates when the schedule changes. Keep the link to yourself. It's your personal schedule.",
      "Next up: your first week."
    ]
  },
  {
    "slug": "6-first-week",
    "title": "Your first week",
    "bonus": false,
    "managers": false,
    "seconds": 51,
    "blurb": "Three habits for the first week: Got it, conflicts, and Messages.",
    "transcript": [
      "Last one: three habits that make your stage manager's life easier.",
      "One: tap Got it on every call. If a time or place changes, it resets, so you'll notice what moved.",
      "It turns into a check mark.",
      "Two: enter your conflicts early. Work trips, weddings, weekly work hours. The schedule gets built around them, and only the managers see them.",
      "Three: check Messages. Each conversation shows its latest note.",
      "Tap in to reply, react, or share a photo.",
      "And the Month view shows your whole run at a glance.",
      "Questions? Open the menu and tap Help for the whole manual. Break a nail!"
    ]
  },
  {
    "slug": "7-fingerprint",
    "title": "Sign in with your fingerprint",
    "bonus": true,
    "managers": false,
    "seconds": 55,
    "blurb": "Optional: skip the emailed code and sign in with your fingerprint or face.",
    "transcript": [
      "Tired of waiting for the emailed code? Sign in with your fingerprint or face instead.",
      "Sign in the usual way first. Then, in My settings, open Fingerprint sign-in.",
      "Tap Set up fingerprint sign-in on this device.",
      "Your phone asks you to confirm with your fingerprint, your face, or the passcode you unlock it with.",
      "That's it. Your phone shows up in the list, and the X turns it off any time.",
      "Next time, tap Sign in with fingerprint or face. No email, no code.",
      "Touch the sensor or look at your phone, and you're in.",
      "Your fingerprint never leaves your phone, and Glow Tape never sees it. The emailed code always still works.",
      "Set it up on each phone or computer you use. Break a nail!"
    ]
  },
  {
    "slug": "8-attendance",
    "title": "Take attendance",
    "bonus": false,
    "managers": true,
    "seconds": 91,
    "blurb": "For directors and stage managers: roll call, called-in notes, door check-in, and the attendance report.",
    "transcript": [
      "Stage managers, this one's for you: taking roll in Glow Tape, in a few taps.",
      "Open the Schedule and tap tonight's rehearsal.",
      "Tap Roll call.",
      "Everyone called tonight is listed. Tap a name once to mark them here.",
      "Tap again for late, and again for missing. One more tap clears it.",
      "Missing names stand out in red, so you know who to check on.",
      "Anyone who tapped Running late or Can't make it is already filed under Called in, with their note.",
      "Got a text or a call instead? Tap Called in beside their name, so they don't count as missing.",
      "Or let the cast check themselves in. Tap Turn on door check-in.",
      "You get a code to scan. Tap Door poster to print it.",
      "Tape it up by the door, or prop an old phone there in kiosk mode.",
      "Cast scan it with their phone camera and tap I'm here. Parents can check in their kids.",
      "They're checked in, with the time.",
      "It lands in your roll call. Tap Refresh roll to catch the latest.",
      "Every rehearsal adds up in Manage, under Attendance report, with season totals for each person. Only managers can see it.",
      "Questions? Open the menu and tap Help for the whole manual. Break a nail!"
    ]
  }
]

export const CORE_VIDEOS = HOWTO_VIDEOS.filter((v) => !v.bonus && !v.managers)

export function seenCount(seen: string[] | null | undefined): number {
  const s = new Set(seen ?? [])
  return CORE_VIDEOS.filter((v) => s.has(v.slug)).length
}

// pomodoro.js
// Pomodoro sidebar block + popup panel — loaded after script.js.
// Depends on dateToStorageString(), defined in script.js, so this
// file must be included AFTER script.js in index.html.
// This file owns everything Pomodoro-related: no other file
// reaches into it, and it doesn't touch anything outside its
// own Pomodoro elements/localStorage keys.

// ======================================================
// POMODORO
// A simple stopwatch: Start/Pause counts up and logs the
// running total for today (reset automatically on a new day).
// Clicking the sidebar block opens a panel to its right, which
// blurs the timeline behind it and closes on outside click or
// Escape. Only the timer itself lives here — the panel body is
// intentionally left empty for future features.
// ======================================================

const pomodoroBlock=document.getElementById("pomodoroBlock");
const pomodoroPanel=document.getElementById("pomodoroPanel");
const pomodoroPanelCloseBtn=document.getElementById("pomodoroPanelCloseBtn");
const pomodoroTimeDisplay=document.getElementById("pomodoroTimeDisplay");
const pomodoroDateDisplay=document.getElementById("pomodoroDateDisplay");
const pomodoroCircles=document.getElementById("pomodoroCircles");

const POMODORO_DATE_KEY="pomodoroLogDate";
const POMODORO_SECONDS_KEY="pomodoroLogSeconds";

let pomodoroSeconds=0;
let pomodoroRunning=false;
let pomodoroIntervalId=null;

// ======================================================
// REAL-TIME TICK TRACKING
// setInterval is NOT a reliable clock: background/inactive tabs get
// throttled hard by the browser (often to ~once a minute or less),
// so a timer that just does `seconds++` on every fire silently loses
// almost all the time spent away from the tab. Every timer below
// instead stamps a real Date.now() when it starts, and on every fire
// (however late that fire actually happens) recomputes seconds from
// actual elapsed wall-clock time rather than counting ticks. That
// keeps the recorded time correct no matter how throttled the
// interval was. A visibilitychange listener further down also forces
// an immediate catch-up the moment the tab becomes visible again, so
// the display doesn't sit stale waiting on the next throttled tick.
// ======================================================
function elapsedRealSeconds(startTimestamp){
    if(!startTimestamp) return 0;
    return Math.max(0,Math.floor((Date.now()-startTimestamp)/1000));
}

let pomodoroStartTimestamp=null;
let pomodoroBaseSeconds=0;
let pomodoroSessionBaseSeconds=0;

// The calendar day pomodoroSeconds is currently being logged under —
// set once in loadPomodoroToday() and left alone after that, so a
// timer left running across midnight keeps saving to the day it
// started instead of quietly rolling onto the new day mid-tick (see
// savePomodoroToday() below). A stopped timer only picks up the new
// day on its next load, same as before.
let pomodoroActiveDateStr=null;

function formatPomodoroTime(totalSeconds){

    const h=Math.floor(totalSeconds/3600);
    const m=Math.floor((totalSeconds%3600)/60);
    const s=totalSeconds%60;

    return [h,m,s]
    .map(v=>String(v).padStart(2,"0"))
    .join(":");

}

function updatePomodoroDisplay(){

    pomodoroTimeDisplay.textContent=formatPomodoroTime(pomodoroSeconds);

}

function formatPomodoroDate(d){

    const months=["jan","feb","mar","apr","may","jun",
                  "jul","aug","sep","oct","nov","dec"];

    const day=String(d.getDate()).padStart(2,"0");
    const month=months[d.getMonth()];
    const year=d.getFullYear();

    return `${day}-${month}-${year}`;

}

function updatePomodoroDateDisplay(){

    pomodoroDateDisplay.textContent=formatPomodoroDate(new Date());

}

function loadPomodoroToday(){

    const todayStr=dateToStorageString(new Date());
    const storedDate=localStorage.getItem(POMODORO_DATE_KEY);

    pomodoroActiveDateStr=todayStr;

    if(storedDate===todayStr){

        const storedSeconds=parseInt(
            localStorage.getItem(POMODORO_SECONDS_KEY),10
        );

        pomodoroSeconds=isNaN(storedSeconds) ? 0 : storedSeconds;

    }else{

        pomodoroSeconds=0;

        localStorage.setItem(POMODORO_DATE_KEY,todayStr);
        localStorage.setItem(POMODORO_SECONDS_KEY,"0");

    }

}

// Always writes under pomodoroActiveDateStr rather than re-deriving
// "today" via new Date() — ticking past midnight must keep crediting
// the day the count started, not silently hand already-logged seconds
// to the new day the instant the clock rolls over.
function savePomodoroToday(){

    localStorage.setItem(
        POMODORO_DATE_KEY,
        pomodoroActiveDateStr
    );

    localStorage.setItem(
        POMODORO_SECONDS_KEY,
        String(pomodoroSeconds)
    );

}

// ======================================================
// TOP PROGRESS CIRCLES
// Circle 1 mirrors the persisted daily total above against a
// daily target. Circle 2 is a fixed 1-hour session: the first
// 50 minutes are study, the last 10 are a break, shown as two
// static colored arcs on the ring track with the same progress
// arc sweeping through both. It isn't persisted — a fresh
// session begins at 0 whenever a subject timer starts from a
// fully idle state (see startSubjectTimer below), and it wraps
// into a new session automatically every time it completes a
// full hour.
// ======================================================

// Today's target is no longer a fixed number — it's the sum of each
// subject's own daily goal (edited in the goals & session ratio
// drawer). subjectTimers/DEFAULT_SUBJECT_GOAL_SECONDS live here (moved
// up from the SUBJECT TIMERS section below) so computeDailyTargetSeconds()
// can read them; loadSubjectGoal() further down still fills in any
// saved values from localStorage on top of these defaults.

// Fallback target used for ANY day that doesn't have its own saved
// snapshot (see the per-day goal snapshots section further down) —
// this is what makes every day, past or future, start from the same
// fixed baseline instead of drifting to whatever was last edited on
// some other day.
const DEFAULT_SUBJECT_GOAL_SECONDS={

    physics:2.5*3600,   // 2h 30m/day
    chemistry:2.5*3600, // 2h 30m/day
    maths:3*3600        // 3h/day

};

// activeDate is the calendar day each subject's seconds are currently
// being logged under — set in loadSubjectToday() and left alone from
// then on, so a subject timer left running across midnight keeps
// saving to the day it started (see saveSubjectToday() below) instead
// of rolling onto the new day mid-tick.
const subjectTimers={

    physics:{seconds:0,running:false,intervalId:null,startTimestamp:null,baseSeconds:0,goalSeconds:DEFAULT_SUBJECT_GOAL_SECONDS.physics,activeDate:null},
    chemistry:{seconds:0,running:false,intervalId:null,startTimestamp:null,baseSeconds:0,goalSeconds:DEFAULT_SUBJECT_GOAL_SECONDS.chemistry,activeDate:null},
    maths:{seconds:0,running:false,intervalId:null,startTimestamp:null,baseSeconds:0,goalSeconds:DEFAULT_SUBJECT_GOAL_SECONDS.maths,activeDate:null}

};

// Sunday task timers (Mock Test / Bookmark Questions / Revision) —
// declared up here alongside subjectTimers, rather than down by the
// rest of the Sunday-task logic further below, because
// renderPomodoroHistory() runs once synchronously as soon as this
// script loads (see the call near the HISTORY section) and its call
// chain (syncMainPanelToHistoryDate -> computeHistoryDaySundayTaskTotals
// / updateSundayTaskDisplay, and renderHistorySubjectRow ->
// SUNDAY_TASK_LABELS) reads both of these. A `const` declared later
// in the file would still be in its temporal dead zone at that point
// and throw — same reasoning as pomodoroSubjectTimersEl above.
const SUNDAY_TASK_LABELS={
    mockTest:"Mock Test",
    bookmark:"Bookmark Questions",
    revision:"Revision"
};

// activeDate mirrors subjectTimers' field above — the day this
// task's seconds are pinned to once loaded, so it keeps logging to
// the day it started if left running across midnight (see
// loadSundayTaskToday()/saveSundayTaskToday() below).
const sundayTaskTimers={
    mockTest:{seconds:0,running:false,intervalId:null,startTimestamp:null,baseSeconds:0,activeDate:null},
    bookmark:{seconds:0,running:false,intervalId:null,startTimestamp:null,baseSeconds:0,activeDate:null},
    revision:{seconds:0,running:false,intervalId:null,startTimestamp:null,baseSeconds:0,activeDate:null}
};

// ---- chapter/test-type SELECTION state ----
// Declared up here for the same reason as subjectTimers/
// sundayTaskTimers/SUNDAY_TASK_LABELS above: renderPomodoroHistory()
// runs synchronously as soon as this script loads, and its call
// chain reaches updateStartButtonGating() (via setSubjectTimerLocked()/
// setSundayTaskLocked()) before the SUBJECT CHAPTER LIST POPOVER
// section further down would otherwise declare these — a `const`
// declared there would still be in its temporal dead zone at that
// point and throw. See that section for how these are used.
const selectedChapterByKey={
    physics:null,
    chemistry:null,
    maths:null,
    mockTest:null,
    bookmark:null,
    revision:null
};

const COMBINED_CHAPTER_ID="__combined__";

function computeDailyTargetSeconds(){

    return Object.values(subjectTimers)
        .reduce((sum,timer)=>sum+timer.goalSeconds,0);

}

const POMODORO_SESSION_STUDY_KEY="pomodoroSessionStudySeconds";
const POMODORO_SESSION_BREAK_KEY="pomodoroSessionBreakSeconds";

let POMODORO_SESSION_STUDY_SECONDS=50*60;   // 50 min study — default, editable
let POMODORO_SESSION_BREAK_SECONDS=10*60;   // 10 min break — default, editable
let POMODORO_SESSION_TARGET_SECONDS=
    POMODORO_SESSION_STUDY_SECONDS+POMODORO_SESSION_BREAK_SECONDS;

// Pulls a saved study:break split from localStorage, if the editor
// panel has ever saved one — otherwise the defaults above stand.
function loadSessionRatio(){

    const storedStudy=parseInt(localStorage.getItem(POMODORO_SESSION_STUDY_KEY),10);
    const storedBreak=parseInt(localStorage.getItem(POMODORO_SESSION_BREAK_KEY),10);

    if(!isNaN(storedStudy) && storedStudy>0){
        POMODORO_SESSION_STUDY_SECONDS=storedStudy;
    }

    if(!isNaN(storedBreak) && storedBreak>=0){
        POMODORO_SESSION_BREAK_SECONDS=storedBreak;
    }

    POMODORO_SESSION_TARGET_SECONDS=
        POMODORO_SESSION_STUDY_SECONDS+POMODORO_SESSION_BREAK_SECONDS;

}

function saveSessionRatio(){

    localStorage.setItem(POMODORO_SESSION_STUDY_KEY,String(POMODORO_SESSION_STUDY_SECONDS));
    localStorage.setItem(POMODORO_SESSION_BREAK_KEY,String(POMODORO_SESSION_BREAK_SECONDS));

}

loadSessionRatio();

// ======================================================
// BROWSER NOTIFICATIONS
// Fires a native browser notification at the two moments a session
// changes phase: study -> break, and break -> session complete. Purely
// additive — if the Notification API doesn't exist (unsupported
// browser) or permission was never granted, these just silently do
// nothing and every other feature keeps working exactly as before.
//
// Permission has to be requested from inside a real user gesture (a
// click), so requestPomodoroNotificationPermission() is called from
// beginPomodoroSession(), which only ever runs as a direct result of
// someone clicking a subject's Start button. It only actually prompts
// the first time — once granted or denied, the browser remembers.
//
// One real limitation, inherent to the browser rather than this code:
// while this tab is in the background, browsers throttle its timers
// (often to about once a minute), so a notification can land up to
// roughly a minute late instead of the instant the phase changes.
// ======================================================

function requestPomodoroNotificationPermission(){

    if(!("Notification" in window)) return;
    if(Notification.permission==="default"){
        Notification.requestPermission();
    }

}

function firePomodoroNotification(title,body){

    if(!("Notification" in window)) return;
    if(Notification.permission!=="granted") return;

    try{
        new Notification(title,{body:body});
    }catch(e){
        // a few browsers (mostly mobile) throw when a Notification is
        // constructed directly instead of via a service worker — there's
        // nothing useful to do about that here, so just ignore it
    }

}

// True once the study portion of the current session has been fully
// ticked through — the break that follows is optional from this
// point on, not something that still has to finish for the session
// to count as done (see pauseSubjectTimer()/pauseSundayTask() below,
// which skip the 30s grace window entirely once this is true).
function isPomodoroStudyPhaseDone(){

    return pomodoroSessionSeconds>=POMODORO_SESSION_STUDY_SECONDS;

}

let pomodoroSessionSeconds=0;

// A session is one-shot: once it reaches its target it completes and
// stays completed (ring full, everything stopped) until a subject
// timer is started again from a fully idle state — see
// completePomodoroSession()/beginPomodoroSession() below.
let pomodoroSessionCompleted=false;

// Real wall-clock timestamp (ms) of when the current session actually
// began — set in beginPomodoroSession(), read in completePomodoroSession()
// to log the session's real start/end time in the history panel.
let pomodoroSessionStartTimestamp=null;

// Per-subject seconds accumulated during the *current* session only
// (reset each new session in beginPomodoroSession, incremented in
// startSubjectTimer's tick). A Map so insertion order tracks which
// subject was worked on first — used to log the session's subject
// breakdown in the history panel.
let pomodoroSessionSubjectSeconds=new Map();

// Keys (subject or Sunday task) whose chapter/test-type is locked in
// for the rest of the *current* session — a key is added the moment
// its timer actually starts running (see startSubjectTimer()/
// startSundayTask()), and the whole set is cleared in
// beginPomodoroSession(). Once a key is in here, its entry in
// selectedChapterByKey can't change (or be cleared) until the
// session ends — either by completing, or by the grace countdown/
// "End Session" resetting it — and a new one begins. Switching to a
// *different*, not-yet-locked subject/task mid-session is unaffected;
// this only guards a key from changing the chapter it already
// started with.
let pomodoroSessionLockedChapterKeys=new Set();

const pomodoroTotalRing=document.getElementById("pomodoroTotalRing");
const pomodoroTotalCircleText=document.getElementById("pomodoroTotalCircleText");
const pomodoroSessionRing=document.getElementById("pomodoroSessionRing");
const pomodoroSessionCircleText=document.getElementById("pomodoroSessionCircleText");
const pomodoroSessionTrackStudy=document.getElementById("pomodoroSessionTrackStudy");
const pomodoroSessionTrackBreak=document.getElementById("pomodoroSessionTrackBreak");
const pomodoroDailyTargetLabel=document.getElementById("pomodoroDailyTargetLabel");
const pomodoroDailyTargetPrefix=document.getElementById("pomodoroDailyTargetPrefix");
const pomodoroTargetLabelWrap=document.getElementById("pomodoroTargetLabelWrap");
const pomodoroSundayTasks=document.getElementById("pomodoroSundayTasks");

// Declared up here (rather than down by alignPomodoroSubjectTimers(),
// which is the only other place that used to reference it) because
// updateSundayMode() below needs it, and updateSundayMode() runs as
// early as the very first renderPomodoroHistory() call further down
// this file — a `const` declared later would still be in its
// temporal dead zone at that point and throw.
const pomodoroSubjectTimersEl=document.querySelector(".pomodoroSubjectTimers");

const POMODORO_RING_CIRCUMFERENCE=2*Math.PI*52; // matches r=52 in the SVG

// Draws the session ring's track as two fixed arcs (study/break),
// sized from the constants above so it stays correct if that split
// ever changes. Dash = visible arc, gap = full circumference so the
// pattern never repeats a second time going around the same circle.
function setupSessionTrackSplit(){

    if(!pomodoroSessionTrackStudy || !pomodoroSessionTrackBreak) return;

    const studyLen=POMODORO_RING_CIRCUMFERENCE*
        (POMODORO_SESSION_STUDY_SECONDS/POMODORO_SESSION_TARGET_SECONDS);

    const breakLen=POMODORO_RING_CIRCUMFERENCE-studyLen;

    pomodoroSessionTrackStudy.style.strokeDasharray=
        `${studyLen} ${POMODORO_RING_CIRCUMFERENCE}`;
    pomodoroSessionTrackStudy.style.strokeDashoffset="0";

    pomodoroSessionTrackBreak.style.strokeDasharray=
        `${breakLen} ${POMODORO_RING_CIRCUMFERENCE}`;
    pomodoroSessionTrackBreak.style.strokeDashoffset=`-${studyLen}`;

}

setupSessionTrackSplit();

// ---- study/break ratio display (below the circles) ----

const pomodoroSessionRatioStudyValue=document.getElementById("pomodoroSessionRatioStudyValue");
const pomodoroSessionRatioBreakValue=document.getElementById("pomodoroSessionRatioBreakValue");

function formatMinutesLabel(totalSeconds){

    const totalMinutes=Math.round(totalSeconds/60);
    const hrs=Math.floor(totalMinutes/60);
    const mins=totalMinutes%60;

    if(hrs>0 && mins>0){
        return `${hrs} hour${hrs===1 ? "" : "s"} ${mins} minute${mins===1 ? "" : "s"}`;
    }

    if(hrs>0){
        return `${hrs} hour${hrs===1 ? "" : "s"}`;
    }

    return `${mins} minute${mins===1 ? "" : "s"}`;

}

function updateSessionRatioDisplay(){

    if(pomodoroSessionRatioStudyValue){
        pomodoroSessionRatioStudyValue.textContent=formatMinutesLabel(POMODORO_SESSION_STUDY_SECONDS);
    }

    if(pomodoroSessionRatioBreakValue){
        pomodoroSessionRatioBreakValue.textContent=formatMinutesLabel(POMODORO_SESSION_BREAK_SECONDS);
    }

}

updateSessionRatioDisplay();

// ---- study/break ticking icons (below the circles, right half of
// each box) — see .pomodoroRatioIcon in pomodoro.css for the three
// visual states this toggles between. ----

const pomodoroStudyRatioBlock=document.getElementById("pomodoroStudyRatioBlock");
const pomodoroBreakRatioBlock=document.getElementById("pomodoroBreakRatioBlock");
const pomodoroStudyRatioIcon=document.getElementById("pomodoroStudyRatioIcon");
const pomodoroBreakRatioIcon=document.getElementById("pomodoroBreakRatioIcon");

function updateSessionPhaseVisuals(){

    if(!pomodoroStudyRatioIcon || !pomodoroBreakRatioIcon) return;

    // no subject timer running at all — both icons stay hidden and
    // neither box glows, regardless of leftover session progress
    if(!pomodoroRunning){

        pomodoroStudyRatioIcon.classList.remove("ticking","activeGlow","idleGrey");
        pomodoroStudyRatioIcon.classList.add("hiddenIcon");

        pomodoroBreakRatioIcon.classList.remove("ticking","activeGlow","idleGrey");
        pomodoroBreakRatioIcon.classList.add("hiddenIcon");

        if(pomodoroStudyRatioBlock) pomodoroStudyRatioBlock.classList.remove("phaseActive");
        if(pomodoroBreakRatioBlock) pomodoroBreakRatioBlock.classList.remove("phaseActive");

        return;

    }

    const inStudyPhase=!isPomodoroStudyPhaseDone();

    pomodoroStudyRatioIcon.classList.remove("hiddenIcon");
    pomodoroBreakRatioIcon.classList.remove("hiddenIcon");

    if(inStudyPhase){

        // pen+mouse tick, glowing — this half is the one running
        pomodoroStudyRatioIcon.classList.add("ticking","activeGlow");
        pomodoroStudyRatioIcon.classList.remove("idleGrey");

        // mug rests on frameA, faded grey, not ticking
        pomodoroBreakRatioIcon.classList.remove("ticking","activeGlow");
        pomodoroBreakRatioIcon.classList.add("idleGrey");

        if(pomodoroStudyRatioBlock) pomodoroStudyRatioBlock.classList.add("phaseActive");
        if(pomodoroBreakRatioBlock) pomodoroBreakRatioBlock.classList.remove("phaseActive");

    }else{

        // pen rests on frameA, faded grey, not ticking
        pomodoroStudyRatioIcon.classList.remove("ticking","activeGlow");
        pomodoroStudyRatioIcon.classList.add("idleGrey");

        // mug ticks (steam/no-steam), glowing — break is now running
        pomodoroBreakRatioIcon.classList.add("ticking","activeGlow");
        pomodoroBreakRatioIcon.classList.remove("idleGrey");

        if(pomodoroStudyRatioBlock) pomodoroStudyRatioBlock.classList.remove("phaseActive");
        if(pomodoroBreakRatioBlock) pomodoroBreakRatioBlock.classList.add("phaseActive");

    }

}

function formatPomodoroTargetLabel(totalSeconds){

    const hrs=totalSeconds/3600;

    return (hrs%1===0) ? `${hrs}h` : `${hrs.toFixed(1)}h`;

}

// Turns a "YYYY-MM-DD" storage date string into the short "DD-MM-YY"
// form used in the "<date> target" label above the first ring when
// browsing a past day — e.g. "2026-09-12" -> "12-09-26".
function formatShortDateLabel(dateStr){

    const [year,month,day]=dateStr.split("-");

    return `${day}-${month}-${year.slice(2)}`;

}

function updatePomodoroRing(ringEl,fraction){

    if(!ringEl) return;

    const clamped=Math.max(0,Math.min(1,fraction));
    const offset=POMODORO_RING_CIRCUMFERENCE*(1-clamped);

    ringEl.style.strokeDasharray=`${POMODORO_RING_CIRCUMFERENCE}`;
    ringEl.style.strokeDashoffset=`${offset}`;

}

function updatePomodoroCircles(){

    // While the history calendar is showing a past day, the first
    // ring is frozen on that day's recorded total by
    // syncMainPanelToHistoryDate() — skip repainting it here so a
    // live tick doesn't creep back in. The session ring below is
    // untouched by history browsing either way, it always stays live.
    if(!isBrowsingPastHistoryDate()){

        if(pomodoroTotalCircleText){
            pomodoroTotalCircleText.textContent=formatPomodoroTime(pomodoroSeconds);
        }

        const dailyTargetSeconds=computeDailyTargetSeconds();

        if(pomodoroDailyTargetPrefix){
            pomodoroDailyTargetPrefix.textContent="Today's target";
        }

        if(pomodoroDailyTargetLabel){
            pomodoroDailyTargetLabel.textContent=formatPomodoroTargetLabel(dailyTargetSeconds);
        }

        updatePomodoroRing(
            pomodoroTotalRing,
            pomodoroSeconds/dailyTargetSeconds
        );

        setDayCompletedVisual(dailyTargetSeconds>0 && pomodoroSeconds>=dailyTargetSeconds);

    }

    if(pomodoroSessionCircleText){
        pomodoroSessionCircleText.textContent=formatPomodoroTime(pomodoroSessionSeconds);
    }

    updatePomodoroRing(
        pomodoroSessionRing,
        pomodoroSessionSeconds/POMODORO_SESSION_TARGET_SECONDS
    );

    updateSundayMode();

}

// Resets the session ring to 0 — called only when a subject timer
// starts from a fully idle state, i.e. a genuinely new study session.
function beginPomodoroSession(){

    pomodoroSessionSeconds=0;
    pomodoroSessionCompleted=false;
    pomodoroSessionStartTimestamp=Date.now();
    pomodoroSessionSubjectSeconds=new Map();
    pomodoroSessionLockedChapterKeys=new Set();

    // always runs off a click (a subject's Start button), so this is
    // a safe place to ask — see the BROWSER NOTIFICATIONS block above
    requestPomodoroNotificationPermission();

    hidePomodoroSessionCompletePopup();

    updatePomodoroCircles();
    updateSessionPhaseVisuals();

}

// ======================================================
// SESSION GRACE PERIOD
// Pausing every subject timer doesn't reset the session ring right
// away — it starts a 30s countdown (shown as a popup over the
// circles) instead. Starting any subject timer again before it runs
// out cancels the countdown and the session just continues from
// where it left off. Only lets the countdown run out and reset the
// session if nothing was resumed in time.
// ======================================================

const POMODORO_SESSION_GRACE_SECONDS=30;

let pomodoroSessionGraceActive=false;
let pomodoroSessionGraceIntervalId=null;
let pomodoroSessionGraceSecondsLeft=0;
let pomodoroSessionGraceStartTimestamp=null;

const pomodoroSessionGracePopup=document.getElementById("pomodoroSessionGracePopup");
const pomodoroSessionGraceCountdown=document.getElementById("pomodoroSessionGraceCountdown");
const pomodoroSessionGraceEndBtn=document.getElementById("pomodoroSessionGraceEndBtn");

function startPomodoroSessionGrace(){

    // nothing worth protecting if the session hasn't actually started
    if(pomodoroSessionSeconds<=0) return;

    pomodoroSessionGraceActive=true;
    pomodoroSessionGraceSecondsLeft=POMODORO_SESSION_GRACE_SECONDS;
    pomodoroSessionGraceStartTimestamp=Date.now();

    if(pomodoroSessionGraceCountdown){
        pomodoroSessionGraceCountdown.textContent=pomodoroSessionGraceSecondsLeft;
    }

    if(pomodoroSessionGracePopup){
        pomodoroSessionGracePopup.classList.remove("hidden");
    }

    pomodoroSessionGraceIntervalId=setInterval(tickPomodoroSessionGrace,1000);

}

// Recomputes the countdown from real elapsed time rather than
// trusting the interval to have fired exactly once per second — a
// backgrounded tab can throttle this interval too, so without this
// the grace popup could sit showing a stale number, or (worse) fire
// its 30s expiry far later than it visually should once the tab
// resumes. Called both by the interval and by the visibilitychange
// catch-up below.
function tickPomodoroSessionGrace(){

    if(!pomodoroSessionGraceActive) return;

    const elapsed=elapsedRealSeconds(pomodoroSessionGraceStartTimestamp);
    const secondsLeft=Math.max(0,POMODORO_SESSION_GRACE_SECONDS-elapsed);

    pomodoroSessionGraceSecondsLeft=secondsLeft;

    if(pomodoroSessionGraceCountdown){
        pomodoroSessionGraceCountdown.textContent=secondsLeft;
    }

    if(secondsLeft<=0){

        clearPomodoroSessionGrace();
        logAbandonedPomodoroSession();
        beginPomodoroSession();

    }

}

// Lets someone genuinely give up on a session early instead of
// waiting out the 30s countdown — logs whatever progress it had as
// "incomplete" and resets immediately, same end state the countdown
// would reach on its own.
function endPomodoroSessionNow(){

    clearPomodoroSessionGrace();
    logAbandonedPomodoroSession();
    beginPomodoroSession();

}

// Ends the session immediately when everything gets paused partway
// through the break — the study portion is already done at that
// point, so unlike endPomodoroSessionNow() there's nothing worth
// protecting with a 30s "still there?" countdown. It logs straight
// away as "completed" (finishing the break was never required) and
// resets for the next session, same as the grace countdown running
// out would, just without the wait.
function endPomodoroSessionAfterStudyDone(){

    clearPomodoroSessionGrace();
    logCompletedPomodoroSession(pomodoroSessionStartTimestamp,Date.now());
    beginPomodoroSession();

}

if(pomodoroSessionGraceEndBtn){

    pomodoroSessionGraceEndBtn.addEventListener("click",(e)=>{

        e.stopPropagation();
        endPomodoroSessionNow();

    });

}

// Cancels the countdown and hides the popup, without touching the
// session's accumulated seconds — used both when a subject timer
// resumes in time, and once the countdown has run its course.
function clearPomodoroSessionGrace(){

    if(pomodoroSessionGraceIntervalId){
        clearInterval(pomodoroSessionGraceIntervalId);
        pomodoroSessionGraceIntervalId=null;
    }

    pomodoroSessionGraceActive=false;
    pomodoroSessionGraceStartTimestamp=null;

    if(pomodoroSessionGracePopup){
        pomodoroSessionGracePopup.classList.add("hidden");
    }

}

// ======================================================
// SESSION COMPLETION
// A session runs once. When it reaches its target it stops for good
// — every subject timer pauses, the top rings stop ticking, and a
// congrats message replaces the grace popup. Nothing auto-restarts
// it: it stays exactly as it finished until a subject timer is
// started again from a fully idle state (see beginPomodoroSession(),
// called from startSubjectTimer()).
// ======================================================

const pomodoroSessionCompletePopup=document.getElementById("pomodoroSessionCompletePopup");

function showPomodoroSessionCompletePopup(){

    if(pomodoroSessionCompletePopup){
        pomodoroSessionCompletePopup.classList.remove("hidden");
    }

}

function hidePomodoroSessionCompletePopup(){

    if(pomodoroSessionCompletePopup){
        pomodoroSessionCompletePopup.classList.add("hidden");
    }

}

function completePomodoroSession(){

    pomodoroSessionCompleted=true;
    pomodoroSessionSeconds=POMODORO_SESSION_TARGET_SECONDS;

    logCompletedPomodoroSession(pomodoroSessionStartTimestamp,Date.now());

    firePomodoroNotification(
        "Session complete",
        "Break's over — nice work."
    );

    // no grace countdown for a completed session — it stops on
    // purpose and stays stopped, it doesn't get quietly reset
    clearPomodoroSessionGrace();

    Object.keys(subjectTimers).forEach((subject)=>{

        if(subjectTimers[subject].running){
            pauseSubjectTimer(subject,{skipGrace:true});
        }

    });

    Object.keys(sundayTaskTimers).forEach((task)=>{

        if(sundayTaskTimers[task].running){
            pauseSundayTask(task,{skipGrace:true});
        }

    });

    pausePomodoroTimer();

    updatePomodoroCircles();
    updateSessionPhaseVisuals();
    showPomodoroSessionCompletePopup();

}

// ======================================================
// GOALS & SESSION RATIO EDITOR
// A small drawer that opens directly above the panel (see
// #pomodoroEditorPanel in pomodoro.css) with two things to edit:
// each subject's daily goal (hours + minutes), and the session
// study:break split used by the circle above and its track arcs.
// Both persist to localStorage so they survive a reload.
// ======================================================

const pomodoroEditorToggleBtn=document.getElementById("pomodoroEditorToggleBtn");
const pomodoroEditorPanel=document.getElementById("pomodoroEditorPanel");
const pomodoroEditorSaveBtn=document.getElementById("pomodoroEditorSaveBtn");

// ======================================================
// HISTORY
// A drawer of the same size/shape/theme as the main panel, opening
// to its right (see #pomodoroHistoryPanel in pomodoro.css). Logs one
// entry per completed session (real start/end clock time + whatever
// study:break ratio was active), persisted per day in localStorage
// and rendered as a summary row (date/start/end/total) plus a
// scrollable list of session boxes below it.
// ======================================================

const pomodoroHistoryToggleBtn=document.getElementById("pomodoroHistoryToggleBtn");
const pomodoroHistoryPanel=document.getElementById("pomodoroHistoryPanel");
const pomodoroHistoryCloseBtn=document.getElementById("pomodoroHistoryCloseBtn");
const pomodoroHistoryDateValue=document.getElementById("pomodoroHistoryDateValue");
const pomodoroHistoryStartValue=document.getElementById("pomodoroHistoryStartValue");
const pomodoroHistoryEndValue=document.getElementById("pomodoroHistoryEndValue");
const pomodoroHistoryTotalValue=document.getElementById("pomodoroHistoryTotalValue");
const pomodoroHistoryLogList=document.getElementById("pomodoroHistoryLogList");
const pomodoroHistoryDateBtn=document.getElementById("pomodoroHistoryDateBtn");
const pomodoroHistoryDateInput=document.getElementById("pomodoroHistoryDateInput");

const POMODORO_HISTORY_LOG_PREFIX="pomodoroHistoryLog_";

function historyLogKey(dateStr){

    return POMODORO_HISTORY_LOG_PREFIX+dateStr;

}

function loadHistoryLogForDate(dateStr){

    try{

        const raw=localStorage.getItem(historyLogKey(dateStr));
        const parsed=raw ? JSON.parse(raw) : [];

        return Array.isArray(parsed) ? parsed : [];

    }catch(e){

        return [];

    }

}

function saveHistoryLogForDate(dateStr,entries){

    localStorage.setItem(historyLogKey(dateStr),JSON.stringify(entries));

}

// Real wall-clock time (e.g. "1:05 PM"), separate from
// formatPomodoroTime() above which formats elapsed durations.
function formatClockTime(timestampMs){

    const d=new Date(timestampMs);

    let hours=d.getHours();
    const minutes=String(d.getMinutes()).padStart(2,"0");
    const ampm=hours>=12 ? "PM" : "AM";

    hours=hours%12;
    if(hours===0) hours=12;

    return `${hours}:${minutes} ${ampm}`;

}

// DD/MM/YY, used only for the history panel's date cell — separate
// from formatPomodoroDate() above, which the sidebar block still uses.
function formatHistoryDate(d){

    const day=String(d.getDate()).padStart(2,"0");
    const month=String(d.getMonth()+1).padStart(2,"0");
    const year=String(d.getFullYear()).slice(-2);

    return `${day}/${month}/${year}`;

}

// Full HH:MM:SS for the subject-breakdown rows, seconds included
// (e.g. "00:01:35"), not a rounded "1m"/"5m" summary.
function formatDurationClock(totalSeconds){

    const s=Math.max(0,Math.floor(totalSeconds));

    const hrs=Math.floor(s/3600);
    const mins=Math.floor((s%3600)/60);
    const secs=s%60;

    const pad=(n)=>String(n).padStart(2,"0");

    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;

}

function capitalizeSubject(subject){

    return subject.charAt(0).toUpperCase()+subject.slice(1);

}

// Turns whatever's currently picked for a key (selectedChapterByKey)
// into the short label shown next to that subject/task in a history
// log row (see renderHistorySubjectRow() below). Called while
// building a session's history entry, at which point the key's
// chapter is still locked in for that session (see
// pomodoroSessionLockedChapterKeys) — so this always reflects
// whatever chapter that session was actually logged under, even
// after the person later picks something else for a future session.
function resolveChapterLabelForKey(key){

    const chapterId=selectedChapterByKey[key];
    if(!chapterId) return "";

    // weekday subjects (physics/chemistry/maths) store the bare
    // chapter name; Mock Test stores the bare option label — both
    // display as-is
    if(subjectTimers[key]!==undefined || key==="mockTest"){
        return chapterId;
    }

    // Bookmark Questions / Revision: either the fixed "Combined"
    // pick, or a "subject::chapterName" pair
    if(chapterId===COMBINED_CHAPTER_ID){
        return "Combined";
    }

    const sepIndex=chapterId.indexOf("::");
    if(sepIndex===-1) return chapterId;

    return capitalizeSubject(chapterId.slice(0,sepIndex))+" – "+chapterId.slice(sepIndex+2);

}

// Snapshot of the current session's data as a loggable entry, tagged
// with how it ended — "completed" (hit its target) or "incomplete"
// (abandoned via the grace countdown running out, or the grace
// popup's end button).
function buildHistoryEntry(startTimestamp,endTimestamp,status){

    return {
        start:startTimestamp,
        end:endTimestamp,
        studyMinutes:Math.round(POMODORO_SESSION_STUDY_SECONDS/60),
        breakMinutes:Math.round(POMODORO_SESSION_BREAK_SECONDS/60),
        status:status,
        subjects:Array.from(pomodoroSessionSubjectSeconds.entries())
            .filter(([,seconds])=>seconds>0)
            .map(([subject,seconds])=>({
                subject,
                seconds,
                chapter:resolveChapterLabelForKey(subject)
            }))
    };

}

// Filed under the session's START day, not its end day — a session
// begun before midnight and finishing (or abandoned) after it should
// still land on the day it started, not get silently reassigned to
// the next day just because that's when it happened to close out.
function saveHistoryEntry(entry){

    const dateStr=dateToStorageString(new Date(entry.start));
    const entries=loadHistoryLogForDate(dateStr);

    entries.push(entry);

    saveHistoryLogForDate(dateStr,entries);
    renderPomodoroHistory(pomodoroHistoryViewedDate);

}

// Called once a session actually completes. One log entry = one
// completed session, counted as "1" regardless of what its study:break
// ratio was (50:10, 100:20, whatever it was set to at the time).
function logCompletedPomodoroSession(startTimestamp,endTimestamp){

    if(!startTimestamp) return;

    saveHistoryEntry(buildHistoryEntry(startTimestamp,endTimestamp,"completed"));

}

// Called when a session is abandoned instead of finished — either the
// 30s grace countdown ran out, or the grace popup's end button was
// clicked. Logs whatever progress/subject breakdown had built up so
// far, marked "incomplete", rather than silently discarding it.
function logAbandonedPomodoroSession(){

    if(!pomodoroSessionStartTimestamp) return;
    if(pomodoroSessionSeconds<=0 && pomodoroSessionSubjectSeconds.size===0) return;

    saveHistoryEntry(
        buildHistoryEntry(pomodoroSessionStartTimestamp,Date.now(),"incomplete")
    );

}

const POMODORO_HISTORY_TICK_SVG=
    `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="1" width="14" height="14" rx="4" fill="#22c55e"/>
        <path d="M4.5 8.2l2.2 2.2 4.8-5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

// Parses the "YYYY-MM-DD" format used both by dateToStorageString()
// and by native <input type="date"> values, back into a local Date —
// the inverse of that format.
function parseStorageDateString(dateStr){

    const [y,m,d]=dateStr.split("-").map(Number);
    return new Date(y,m-1,d);

}

// Which day the history panel is currently showing — defaults to
// today, but the calendar picker below can point it at any past day.
// Kept as its own variable (rather than always re-deriving "today")
// so a session completing in the background doesn't yank the view
// back to today while an older day is open.
let pomodoroHistoryViewedDate=null;

function isBrowsingPastHistoryDate(){

    return !!pomodoroHistoryViewedDate &&
        pomodoroHistoryViewedDate!==dateToStorageString(new Date());

}

// ======================================================
// SUNDAY MODE
// Sundays are combined-study days, not split Physics/Chemistry/
// Maths — so the three subject timer rows are swapped out for the
// static Mock Test / Bookmark Questions / Revision boxes, and the
// first ring's target swaps to a "Free" badge. Applies to whichever
// day is actually being looked at: today live, or a past Sunday
// picked in the history calendar. Called at the end of both
// updatePomodoroCircles() (today path) and syncMainPanelToHistoryDate()
// (history path) so it always runs after those set the target text,
// and it can override it.
// ======================================================

// Sundays have no per-subject goal to hit (they're combined
// free-study days — see the comment block above), so the Subject
// goals editor section is faded and made non-interactive on
// Sundays. Deliberately separate from setGoalEditorLocked() (history
// browsing) below: that one locks the WHOLE editor (goals AND
// session ratio) because a past day's numbers are frozen history;
// this one only ever touches the goals half, since the session
// ratio is a live setting that should stay adjustable every day,
// Sunday included. Queries inputs directly by id rather than via the
// subjectGoalInputs object further down the file, since this can run
// (via updateSundayMode() -> syncMainPanelToHistoryDate()) before
// that object is declared.
function setSubjectGoalsEditorLocked(locked){

    const section=document.getElementById("editorSubjectGoalsSection");
    if(section){
        section.classList.toggle("editorSectionDisabled",locked);
    }

    ["physics","chemistry","maths"].forEach((subject)=>{

        const hrs=document.getElementById(subject+"GoalHoursInput");
        const mins=document.getElementById(subject+"GoalMinutesInput");

        if(hrs) hrs.disabled=locked;
        if(mins) mins.disabled=locked;

    });

}

function isSundayDateStr(dateStr){

    return parseStorageDateString(dateStr).getDay()===0;

}

// Tracks whether the last updateSundayMode() run was showing Sunday
// mode or the normal subject timers — so alignment only gets
// recomputed on the actual transition (see below), not on every
// tick. Starts at null so the very first run (whichever mode it
// lands on) always counts as "changed" and aligns once up front.
let pomodoroLastSundayState=null;

function updateSundayMode(){

    const dateStr=isBrowsingPastHistoryDate()
        ? pomodoroHistoryViewedDate
        : dateToStorageString(new Date());

    const isSunday=isSundayDateStr(dateStr);
    const sundayStateChanged=pomodoroLastSundayState!==isSunday;
    pomodoroLastSundayState=isSunday;

    if(pomodoroSubjectTimersEl){
        pomodoroSubjectTimersEl.style.display=isSunday ? "none" : "";
    }

    if(pomodoroSundayTasks){
        pomodoroSundayTasks.classList.toggle("hidden",!isSunday);
    }

    // The target badge's pill styling is unconditional now (every
    // day gets it, not just Sunday — see the CSS) — only the TEXT
    // still needs a Sunday override, done below on top of whatever
    // updatePomodoroCircles()/syncMainPanelToHistoryDate() already
    // wrote into it this tick.
    if(isSunday && pomodoroDailyTargetLabel){
        pomodoroDailyTargetLabel.textContent="Free";
    }

    // Sundays have no subject goals to hit (see above), so there's no
    // real "fraction complete" to show on the first ring — instead it
    // just always reads as fully done, same green/glow look as a
    // normal day that hit its target (setDayCompletedVisual() below
    // is the exact function that does that elsewhere). Runs after
    // updatePomodoroCircles()/syncMainPanelToHistoryDate() already set
    // the ring from the (irrelevant, on Sunday) weekday fraction, so
    // this overrides it the same way the label override above does.
    if(isSunday){
        updatePomodoroRing(pomodoroTotalRing,1);
        setDayCompletedVisual(true);
    }

    // Same reasoning as the ring override just above — no subject
    // goals apply on a Sunday, so the goals half of the editor is
    // faded/disabled while it's showing (see setSubjectGoalsEditorLocked()).
    // The session-ratio half is untouched and stays editable regardless.
    setSubjectGoalsEditorLocked(isSunday);

    // Switching FROM Sunday mode back to the normal subject-timer
    // rows brings .pomodoroSubjectTimers back from display:none —
    // its cached padding-top (from alignPomodoroSubjectTimers()) is
    // stale at that instant, since it was last measured while the
    // element wasn't part of the layout. Realigning right here, on
    // the actual transition, is what avoids the old "shifted down
    // until you scroll" glitch — no scroll event needed to trigger it.
    if(!isSunday && sundayStateChanged){
        alignPomodoroSubjectTimers();
    }

}

// Only the session log entries are saved per past day — not a
// running per-subject total like subjectTimers holds for today — so
// a past day's subject totals are rebuilt by summing that day's
// logged sessions' subject breakdowns.
function computeHistoryDaySubjectTotals(dateStr){

    const totals={physics:0,chemistry:0,maths:0};

    loadHistoryLogForDate(dateStr).forEach((entry)=>{

        (entry.subjects || []).forEach(({subject,seconds})=>{

            if(totals[subject]!==undefined){
                totals[subject]+=seconds;
            }

        });

    });

    return totals;

}

// Starting/pausing only makes sense for today — a past day's row is
// read-only. Toggles the plain-circle icon in place of play/pause
// (see .historyDisabled in pomodoro.css) and blocks the click. The
// chapters button gets the same treatment — chapters shown there
// belong to the subject in general, not to a specific past day, so
// it's locked alongside Start/Pause rather than left active.
function setSubjectTimerLocked(subject,locked){

    const btn=document.getElementById(subject+"StartPauseBtn");
    if(btn){
        btn.classList.toggle("historyDisabled",locked);
        btn.disabled=locked;
        btn.setAttribute("aria-label",
            locked ? "Timer locked — viewing a past day" : "Start "+subject+" timer"
        );
    }

    const chapterBtn=document.getElementById(subject+"ChapterBtn");
    if(chapterBtn){
        chapterBtn.classList.toggle("historyDisabled",locked);
        chapterBtn.disabled=locked;
        chapterBtn.setAttribute("aria-label",
            locked ? capitalizeSubject(subject)+" chapters locked — viewing a past day" : capitalizeSubject(subject)+" chapters"
        );
        chapterBtn.title=locked ? "Locked — viewing a past day" : "View "+capitalizeSubject(subject)+" chapters";
        // a locked subject's popover shouldn't stay open behind it
        if(locked && openChapterPopoverSubject===subject){
            closeSubjectChapterPopover();
        }
    }

    // re-sync the chapter-required styling once Start/Pause is
    // usable again (leaving history view back to today)
    if(!locked){
        updateStartButtonGating(subject);
    }

}

// Toggles the total ring's green "day complete" color. Shared by
// both the live (today) path in updatePomodoroCircles() and the
// history path in syncMainPanelToHistoryDate() below, so a completed
// day looks the same whether it's happening right now or being
// looked back on. The ring is the only thing this marks — the
// per-subject "Completed" tags (see updateSubjectDisplay()) are
// separate and are the only completion badges shown elsewhere.
function setDayCompletedVisual(completed){

    if(pomodoroTotalRing){
        pomodoroTotalRing.classList.toggle("dayCompleted",completed);
    }

}

// Editing goals only makes sense for today — a past day's target is
// a fixed historical record now (see the per-day goal snapshots
// above), not something that should change retroactively. Fades and
// disables the editor toggle button while the history calendar is on
// a past day, mirroring setSubjectTimerLocked() above; also closes
// the editor drawer if it happened to be open when a past day is
// selected.
function setGoalEditorLocked(locked){

    if(!pomodoroEditorToggleBtn) return;

    pomodoroEditorToggleBtn.classList.toggle("historyDisabled",locked);
    pomodoroEditorToggleBtn.disabled=locked;
    pomodoroEditorToggleBtn.setAttribute("aria-label",
        locked ? "Editing locked — viewing a past day" : "Edit goals and session ratio"
    );

    if(locked && pomodoroEditorPanel && pomodoroEditorPanel.classList.contains("open")){
        closePomodoroEditor();
    }

}

// Keeps the main panel's subject rows and the first ring (today's
// target — NOT the session ring, which always stays live, see the
// note inside updatePomodoroCircles()) matching whichever day the
// history calendar is on. Viewing today restores the live, ticking
// numbers and unlocks Start/Pause + the goals editor; viewing a past
// day freezes each row at that day's recorded total/target, locks
// both, and marks whatever was actually completed that day.
function syncMainPanelToHistoryDate(){

    if(!isBrowsingPastHistoryDate()){

        Object.keys(subjectTimers).forEach((subject)=>{
            updateSubjectDisplay(subject);
            setSubjectTimerLocked(subject,false);
        });

        Object.keys(sundayTaskTimers).forEach((task)=>{
            updateSundayTaskDisplay(task);
            setSundayTaskLocked(task,false);
        });

        setGoalEditorLocked(false);

        updatePomodoroCircles();

        return;

    }

    const totals=computeHistoryDaySubjectTotals(pomodoroHistoryViewedDate);

    Object.keys(subjectTimers).forEach((subject)=>{

        const goalForDate=getSubjectGoalForDate(subject,pomodoroHistoryViewedDate);

        updateSubjectDisplay(subject,totals[subject],goalForDate);
        setSubjectTimerLocked(subject,true);

    });

    const sundayTaskTotals=computeHistoryDaySundayTaskTotals(pomodoroHistoryViewedDate);

    Object.keys(sundayTaskTimers).forEach((task)=>{

        updateSundayTaskDisplay(task,sundayTaskTotals[task]);
        setSundayTaskLocked(task,true);

    });

    setGoalEditorLocked(true);

    const dayTotalSeconds=totals.physics+totals.chemistry+totals.maths+
        sundayTaskTotals.mockTest+sundayTaskTotals.bookmark+sundayTaskTotals.revision;
    const dayTargetSeconds=computeDayTargetSeconds(pomodoroHistoryViewedDate);

    if(pomodoroTotalCircleText){
        pomodoroTotalCircleText.textContent=formatPomodoroTime(dayTotalSeconds);
    }

    if(pomodoroDailyTargetPrefix){
        pomodoroDailyTargetPrefix.textContent=
            `${formatShortDateLabel(pomodoroHistoryViewedDate)} target`;
    }

    if(pomodoroDailyTargetLabel){
        pomodoroDailyTargetLabel.textContent=formatPomodoroTargetLabel(dayTargetSeconds);
    }

    updatePomodoroRing(pomodoroTotalRing,dayTotalSeconds/dayTargetSeconds);

    setDayCompletedVisual(dayTargetSeconds>0 && dayTotalSeconds>=dayTargetSeconds);

    updateSundayMode();

}

// Top summary row (date / first start / last end / total logs) plus
// the scrollable list of session boxes below it — both scoped to
// whichever day is passed in (defaults to today), same shape either
// way since every day logs to its own localStorage key.
function renderPomodoroHistory(dateStr){

    dateStr=dateStr || dateToStorageString(new Date());
    pomodoroHistoryViewedDate=dateStr;

    syncMainPanelToHistoryDate();

    const entries=loadHistoryLogForDate(dateStr);

    if(pomodoroHistoryDateValue){
        pomodoroHistoryDateValue.textContent=formatHistoryDate(parseStorageDateString(dateStr));
    }

    if(pomodoroHistoryStartValue){
        pomodoroHistoryStartValue.textContent=
            entries.length ? formatClockTime(entries[0].start) : "—";
    }

    if(pomodoroHistoryEndValue){
        pomodoroHistoryEndValue.textContent=
            entries.length ? formatClockTime(entries[entries.length-1].end) : "—";
    }

    if(pomodoroHistoryTotalValue){

        // top tally counts completed sessions only — incomplete ones
        // still show up in the list below, just aren't counted here
        const completedCount=entries.filter(
            e=>(e.status || "completed")==="completed"
        ).length;

        pomodoroHistoryTotalValue.innerHTML=
            `<span>${completedCount} session${completedCount===1 ? "" : "s"}</span>`+
            `<span class="pomodoroHistoryTotalTick">${POMODORO_HISTORY_TICK_SVG}</span>`;

    }

    if(!pomodoroHistoryLogList) return;

    if(!entries.length){

        const isToday=dateStr===dateToStorageString(new Date());

        pomodoroHistoryLogList.innerHTML=
            `<div class="pomodoroHistoryEmpty">No sessions logged ${isToday ? "yet today" : "on this day"}.</div>`;

        return;

    }

    pomodoroHistoryLogList.innerHTML=entries.map((entry,i)=>{

        const startLabel=formatClockTime(entry.start);
        const endLabel=formatClockTime(entry.end);
        const subjects=entry.subjects || [];
        const status=entry.status || "completed"; // older entries pre-date this field

        const statusLabel=status==="incomplete" ? "Incomplete" : "Completed";

        const primarySubjectHtml=subjects.length
            ? renderHistorySubjectRow(subjects[0])
            : "";

        const extraSubjects=subjects.slice(1);

        const extraSubjectsHtml=extraSubjects
            .map(s=>renderHistorySubjectRow(s,true))
            .join("");

        const moreBtnHtml=extraSubjects.length
            ? `<button type="button" class="pomodoroHistoryLogMoreBtn">+${extraSubjects.length} subject${extraSubjects.length===1 ? "" : "s"}</button>`
            : "";

        return `
            <div class="pomodoroHistoryLogItem">
                <div class="pomodoroHistoryLogTopRow">
                    <span class="pomodoroHistoryLogIndex">#${i+1}</span>
                    <span class="pomodoroHistoryLogTime">${startLabel} – ${endLabel}</span>
                    <span class="pomodoroHistoryLogRatio">${entry.studyMinutes}:${entry.breakMinutes}</span>
                    <span class="pomodoroHistoryLogStatus ${status}">${statusLabel}</span>
                </div>
                ${subjects.length ? `
                <div class="pomodoroHistoryLogSubjects">
                    ${primarySubjectHtml}
                    ${extraSubjectsHtml}
                    ${moreBtnHtml}
                </div>` : ""}
            </div>
        `;

    }).join("");

    setupHistoryLogScrollAnimation();

}

// Watches each log item against the log list's own scrollable area
// (not the page) and toggles .popIn as it crosses the threshold —
// both entering AND leaving, so the "pop up from below" animation
// replays every time you scroll down to a new item, and again if you
// scroll back up past it and return. CSS in pomodoro.css handles the
// actual translateY+scale "zoom up" motion via that class.
let pomodoroHistoryLogObserver=null;

function setupHistoryLogScrollAnimation(){

    if(!pomodoroHistoryLogList) return;

    if(!("IntersectionObserver" in window)){
        // No IO support: just show everything, no animation.
        pomodoroHistoryLogList.querySelectorAll(".pomodoroHistoryLogItem")
            .forEach(item=>item.classList.add("popIn"));
        return;
    }

    if(pomodoroHistoryLogObserver){
        pomodoroHistoryLogObserver.disconnect();
    }

    pomodoroHistoryLogObserver=new IntersectionObserver((observed)=>{

        observed.forEach(entry=>{
            entry.target.classList.toggle("popIn",entry.isIntersecting);
        });

    },{
        root:pomodoroHistoryLogList,
        threshold:0.15,
        rootMargin:"0px 0px -6% 0px"
    });

    pomodoroHistoryLogList.querySelectorAll(".pomodoroHistoryLogItem")
        .forEach(item=>pomodoroHistoryLogObserver.observe(item));

}

function renderHistorySubjectRow(subjectEntry,isExtra){

    // Sunday tasks (Mock Test / Bookmark Questions / Revision) log
    // into this same breakdown as the weekday subjects, but always
    // get the one neon-blue dot instead of a per-subject colour, and
    // their proper multi-word label instead of capitalizeSubject()'s
    // straight capitalization (which would read "MockTest").
    const sundayLabel=SUNDAY_TASK_LABELS[subjectEntry.subject];
    const isSundayTask=sundayLabel!==undefined;

    const dotClass=isSundayTask ? "sundayTaskDot" : subjectEntry.subject;
    const nameLabel=isSundayTask ? sundayLabel : capitalizeSubject(subjectEntry.subject);

    // older entries logged before chapter tracking was added won't
    // have this field — the middle slot just renders empty for those
    const chapterLabel=subjectEntry.chapter || "";

    return `
        <div class="pomodoroHistoryLogSubjectRow${isExtra ? " pomodoroHistoryLogSubjectExtra" : ""}">
            <span class="pomodoroHistoryLogSubjectDot ${dotClass}"></span>
            <span class="pomodoroHistoryLogSubjectName">${nameLabel}</span>
            <span class="pomodoroHistoryLogSubjectChapter" title="${escapeAttr(chapterLabel)}">${escapeAttr(chapterLabel)}</span>
            <span class="pomodoroHistoryLogSubjectTime">${formatDurationClock(subjectEntry.seconds)}</span>
        </div>
    `;

}

renderPomodoroHistory();

// Clicking "+N subjects" expands that session's box to reveal the
// rest of the subject breakdown, in the same dot/name/time format.
if(pomodoroHistoryLogList){

    pomodoroHistoryLogList.addEventListener("click",(e)=>{

        const moreBtn=e.target.closest(".pomodoroHistoryLogMoreBtn");
        if(!moreBtn) return;

        const item=moreBtn.closest(".pomodoroHistoryLogItem");
        if(!item) return;

        const nowExpanded=item.classList.toggle("expanded");
        const extraCount=item.querySelectorAll(".pomodoroHistoryLogSubjectExtra").length;

        moreBtn.textContent=nowExpanded
            ? "Show less"
            : `+${extraCount} subject${extraCount===1 ? "" : "s"}`;

    });

}

// ---- history date picker ----
// The data for every past day was already being saved (each day logs
// to its own localStorage key, see historyLogKey()) — this just adds
// a way to browse it. The calendar button opens the invisible native
// date input's picker; picking a date re-renders the same summary
// row + log list you'd see for today, just for that day instead.
// Reopening the panel still resets the view to today, same as every
// other transient bit of panel state.

if(pomodoroHistoryDateBtn && pomodoroHistoryDateInput){

    pomodoroHistoryDateInput.max=dateToStorageString(new Date());

    pomodoroHistoryDateBtn.addEventListener("click",(e)=>{

        e.stopPropagation();

        pomodoroHistoryDateInput.value=pomodoroHistoryViewedDate || dateToStorageString(new Date());

        if(typeof pomodoroHistoryDateInput.showPicker==="function"){
            pomodoroHistoryDateInput.showPicker();
        }else{
            pomodoroHistoryDateInput.focus();
            pomodoroHistoryDateInput.click();
        }

    });

    pomodoroHistoryDateInput.addEventListener("change",()=>{

        if(!pomodoroHistoryDateInput.value) return;

        const picked=parseStorageDateString(pomodoroHistoryDateInput.value);
        renderPomodoroHistory(dateToStorageString(picked));

    });

}

function openPomodoroHistory(){

    renderPomodoroHistory();

    pomodoroHistoryPanel.classList.add("open");
    pomodoroHistoryToggleBtn.classList.add("active");
    pomodoroHistoryToggleBtn.setAttribute("aria-expanded","true");

}

function closePomodoroHistory(){

    if(!pomodoroHistoryPanel) return;

    pomodoroHistoryPanel.classList.remove("open");
    pomodoroHistoryToggleBtn.classList.remove("active");
    pomodoroHistoryToggleBtn.setAttribute("aria-expanded","false");

    // history browsing is a transient overlay, not a standing mode —
    // closing the drawer always drops the main panel back to today
    renderPomodoroHistory();

}

if(pomodoroHistoryToggleBtn && pomodoroHistoryPanel){

    pomodoroHistoryToggleBtn.addEventListener("click",(e)=>{

        e.stopPropagation();

        if(pomodoroHistoryPanel.classList.contains("open")){
            closePomodoroHistory();
        }else{
            openPomodoroHistory();
        }

    });

}

// Only two ways to close the history drawer now: re-clicking the
// toggle button above (handled just above), or the × button that
// floats above the drawer itself (see #pomodoroHistoryCloseBtn in
// index.html/pomodoro.css). Clicking outside it no longer closes it —
// that used to also fire (and close the whole main panel) whenever a
// click landed on something like the subject chapter popover's search
// box, which lives outside #pomodoroPanel and so read as "outside".
if(pomodoroHistoryCloseBtn){

    pomodoroHistoryCloseBtn.addEventListener("click",(e)=>{

        e.stopPropagation();
        closePomodoroHistory();

    });

}

const editorSessionStudyInput=document.getElementById("editorSessionStudyInput");
const editorSessionBreakInput=document.getElementById("editorSessionBreakInput");

const subjectGoalInputs={

    physics:{
        hours:document.getElementById("physicsGoalHoursInput"),
        minutes:document.getElementById("physicsGoalMinutesInput")
    },
    chemistry:{
        hours:document.getElementById("chemistryGoalHoursInput"),
        minutes:document.getElementById("chemistryGoalMinutesInput")
    },
    maths:{
        hours:document.getElementById("mathsGoalHoursInput"),
        minutes:document.getElementById("mathsGoalMinutesInput")
    }

};

function openPomodoroEditor(){

    populatePomodoroEditorFields();

    pomodoroEditorPanel.classList.add("open");
    pomodoroEditorToggleBtn.classList.add("active");
    pomodoroEditorToggleBtn.setAttribute("aria-expanded","true");

}

function closePomodoroEditor(){

    if(!pomodoroEditorPanel) return;

    pomodoroEditorPanel.classList.remove("open");
    pomodoroEditorToggleBtn.classList.remove("active");
    pomodoroEditorToggleBtn.setAttribute("aria-expanded","false");

}

function populatePomodoroEditorFields(){

    Object.keys(subjectGoalInputs).forEach((subject)=>{

        const inputs=subjectGoalInputs[subject];
        const totalSeconds=subjectTimers[subject].goalSeconds;

        if(inputs.hours){
            inputs.hours.value=Math.floor(totalSeconds/3600);
        }

        if(inputs.minutes){
            inputs.minutes.value=Math.round((totalSeconds%3600)/60);
        }

    });

    if(editorSessionStudyInput){
        editorSessionStudyInput.value=Math.round(POMODORO_SESSION_STUDY_SECONDS/60);
    }

    if(editorSessionBreakInput){
        editorSessionBreakInput.value=Math.round(POMODORO_SESSION_BREAK_SECONDS/60);
    }

}

function savePomodoroEditorFields(){

    // Subject goals don't apply on Sundays (see setSubjectGoalsEditorLocked()
    // in updateSundayMode()) — the inputs are disabled and faded, so
    // skip writing them back at all rather than just re-saving
    // whatever value happened to be sitting in a disabled field.
    if(!isSundayDateStr(dateToStorageString(new Date()))){

        Object.keys(subjectGoalInputs).forEach((subject)=>{

            const inputs=subjectGoalInputs[subject];

            const hrs=Math.max(0,parseInt(inputs.hours && inputs.hours.value,10) || 0);
            const mins=Math.max(0,Math.min(59,parseInt(inputs.minutes && inputs.minutes.value,10) || 0));

            subjectTimers[subject].goalSeconds=(hrs*3600)+(mins*60);

            saveSubjectGoal(subject);

            // the editor is only reachable on today (locked otherwise —
            // see setGoalEditorLocked()), so this always records today's
            // target, never rewrites a past day's saved snapshot
            saveSubjectGoalForDate(subject,dateToStorageString(new Date()));

        });

    }

    // history-aware refresh: a goal change updates the tag/bar
    // denominator whether the panel is live or viewing a past day —
    // it just shouldn't flip a frozen historical row back to today's
    // live seconds in the process.
    syncMainPanelToHistoryDate();

    let studyMinutes=parseInt(editorSessionStudyInput && editorSessionStudyInput.value,10);
    let breakMinutes=parseInt(editorSessionBreakInput && editorSessionBreakInput.value,10);

    if(isNaN(studyMinutes) || studyMinutes<1) studyMinutes=1;
    if(isNaN(breakMinutes) || breakMinutes<0) breakMinutes=0;

    POMODORO_SESSION_STUDY_SECONDS=studyMinutes*60;
    POMODORO_SESSION_BREAK_SECONDS=breakMinutes*60;
    POMODORO_SESSION_TARGET_SECONDS=
        POMODORO_SESSION_STUDY_SECONDS+POMODORO_SESSION_BREAK_SECONDS;

    saveSessionRatio();
    setupSessionTrackSplit();
    updateSessionRatioDisplay();

    // editing the session length mid-session should NOT restart it —
    // whatever progress there was keeps going exactly as it was, just
    // measured against the new track shape. A completed session is
    // left alone entirely; it only starts fresh once a subject timer
    // is started again. The one edge case: if the new (shorter)
    // target is already behind the current progress, the session
    // completes immediately rather than sitting in an impossible
    // over-100% state.
    if(!pomodoroSessionCompleted){

        if(pomodoroSessionSeconds>=POMODORO_SESSION_TARGET_SECONDS){
            completePomodoroSession();
        }else{
            updatePomodoroCircles();
            updateSessionPhaseVisuals();
        }

    }

}

if(pomodoroEditorToggleBtn && pomodoroEditorPanel){

    pomodoroEditorToggleBtn.addEventListener("click",(e)=>{

        e.stopPropagation();

        if(pomodoroEditorToggleBtn.classList.contains("historyDisabled")) return;

        if(pomodoroEditorPanel.classList.contains("open")){
            closePomodoroEditor();
        }else{
            openPomodoroEditor();
        }

    });

}

if(pomodoroEditorSaveBtn){

    pomodoroEditorSaveBtn.addEventListener("click",()=>{

        savePomodoroEditorFields();
        closePomodoroEditor();

    });

}

// clicking outside the editor (but still inside the wider panel)
// closes just the editor, leaving the main panel open
document.addEventListener("click",(e)=>{

    if(!pomodoroEditorPanel || !pomodoroEditorPanel.classList.contains("open")) return;

    if(e.target.closest("#pomodoroEditorPanel")) return;
    if(e.target.closest("#pomodoroEditorToggleBtn")) return;

    closePomodoroEditor();

});

function startPomodoroTimer(){

    if(pomodoroRunning) return;

    pomodoroRunning=true;
    pomodoroStartTimestamp=Date.now();
    pomodoroBaseSeconds=pomodoroSeconds;
    pomodoroSessionBaseSeconds=pomodoroSessionSeconds;
    document.body.classList.add("pomodoroRunning");
    updateSessionPhaseVisuals();

    pomodoroIntervalId=setInterval(tickPomodoroTimer,1000);

}

// Recomputes pomodoroSeconds/pomodoroSessionSeconds from real
// elapsed time since the timer started, instead of trusting the
// interval to have fired once per second. A backgrounded tab
// throttles setInterval (often to ~once a minute or worse), so the
// old `seconds++` version only ever counted the handful of ticks
// that survived the throttling — this is why switching tabs for 50
// minutes only ever recorded 2-3. Idempotent and safe to call more
// than once for the same instant (e.g. once from the interval, once
// from the visibilitychange catch-up) — it always recomputes from
// the same startTimestamp rather than accumulating.
function tickPomodoroTimer(){

    if(!pomodoroRunning || pomodoroSessionCompleted) return;

    // read before pomodoroSessionSeconds moves, so it can be compared
    // against the post-update value below to catch the exact tick the
    // study phase finishes and the break phase begins
    const wasStudyPhaseDone=isPomodoroStudyPhaseDone();

    const elapsedRaw=elapsedRealSeconds(pomodoroStartTimestamp);
    const neededForCompletion=POMODORO_SESSION_TARGET_SECONDS-pomodoroSessionBaseSeconds;
    const cappedElapsed=Math.max(0,Math.min(elapsedRaw,neededForCompletion));

    const newTotalSeconds=pomodoroBaseSeconds+cappedElapsed;
    const newSessionSeconds=pomodoroSessionBaseSeconds+cappedElapsed;

    // nothing has actually changed yet (e.g. called twice within the
    // same second) — skip the redundant display update/save
    if(newTotalSeconds===pomodoroSeconds && newSessionSeconds===pomodoroSessionSeconds) return;

    pomodoroSeconds=newTotalSeconds;
    pomodoroSessionSeconds=newSessionSeconds;

    updatePomodoroDisplay();
    savePomodoroToday();

    // a session runs once — hitting the target stops everything
    // and marks it done, it doesn't loop into a fresh session
    if(pomodoroSessionSeconds>=POMODORO_SESSION_TARGET_SECONDS){
        completePomodoroSession();
    }else{

        // the moment study time runs out and break time begins —
        // completePomodoroSession() above covers the other transition
        // (break running out / the whole session finishing)
        if(!wasStudyPhaseDone && isPomodoroStudyPhaseDone()){
            firePomodoroNotification(
                "Study session done",
                "Break time — take a breather."
            );
        }

        updatePomodoroCircles();
        updateSessionPhaseVisuals();
    }

}

function pausePomodoroTimer(){

    if(!pomodoroRunning) return;

    // catch up on any elapsed real time since the last tick fired
    // (matters if the interval got throttled) before freezing seconds
    tickPomodoroTimer();

    pomodoroRunning=false;
    pomodoroStartTimestamp=null;
    document.body.classList.remove("pomodoroRunning");
    updateSessionPhaseVisuals();

    clearInterval(pomodoroIntervalId);
    pomodoroIntervalId=null;

    savePomodoroToday();

}

// ======================================================
// POMODORO PANEL OPEN / CLOSE
// ======================================================

// ======================================================
// SUBJECT TIMER ROW ALIGNMENT
// Lines the panel's physics/chemistry/maths rows up with their
// matching sidebar cards. The rows share the sidebar's exact
// height+gap rhythm (--rowHeight/--rowGap, see pomodoro.css), so
// only ONE offset is needed: push the whole row block down by
// however far the physics row sits above the sidebar's physics
// card, via padding-top on .pomodoroSubjectTimers. Chemistry and
// maths then land in place automatically.
// ======================================================

function alignPomodoroSubjectTimers(){

    if(pomodoroPanel.classList.contains("hidden")) return;
    if(!pomodoroSubjectTimersEl) return;

    const physicsCard=document.querySelector(".subject.physics");

    if(!physicsCard) return;

    pomodoroSubjectTimersEl.style.paddingTop="0px";

    const containerTop=pomodoroSubjectTimersEl.getBoundingClientRect().top;
    const cardTop=physicsCard.getBoundingClientRect().top;
    const offset=Math.max(0,cardTop-containerTop);

    pomodoroSubjectTimersEl.style.paddingTop=offset+"px";

}

// ================= SUBJECT CHAPTER LIST POPOVER =================
// Opened via a subject timer row's "chapters" button (beside its
// Start/Pause). Lists that subject's chapters — pulled straight from
// `chapters`, the same array script.js draws the main timeline from —
// in a small scrollable popover. Just the list for now; what clicking
// a chapter row actually does gets wired up separately.

const subjectChapterPopover=document.getElementById("subjectChapterPopover");
const subjectChapterPopoverTitle=document.getElementById("subjectChapterPopoverTitle");
const subjectChapterPopoverList=document.getElementById("subjectChapterPopoverList");
const subjectChapterPopoverLockNote=document.getElementById("subjectChapterPopoverLockNote");

// ---- chapter/test-type SELECTION ----
// Starting any of the 6 timers (physics/chemistry/maths/mockTest/
// bookmark/revision) now requires picking one option from that
// timer's popover first — a specific chapter, the "Combined" entry,
// or (for Mock Test) one of the 3 fixed test types. Selection is
// per-key, day-scoped (resets each new day, same pattern as
// subjectTimers[subject].seconds below), and drives both the yellow
// tick shown on the chosen popover row and whether Start/Pause is
// allowed to actually start a fresh session (see updateStartButtonGating()
// and the Start/Pause click handlers further down). selectedChapterByKey
// and COMBINED_CHAPTER_ID themselves are declared earlier, alongside
// subjectTimers/sundayTaskTimers, for the reason noted there.

// Minimal attribute-safe escaping for chapter names embedded in
// data-chapter-id (chapter names can contain quotes/apostrophes,
// e.g. "Newton's Laws").
function escapeAttr(str){

    return String(str)
        .replace(/&/g,"&amp;")
        .replace(/"/g,"&quot;")
        .replace(/'/g,"&#39;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;");

}

function selectedChapterDateKey(key){

    return `selectedChapterDate_${key}`;

}

function selectedChapterIdKey(key){

    return `selectedChapterId_${key}`;

}

// Same day-scoped reset pattern as loadSubjectToday()/
// loadSundayTaskToday() below — a selection made on a previous day
// shouldn't silently carry over and let today's session start
// without the person actually choosing today's chapter.
function loadSelectedChapterForKey(key){

    const todayStr=dateToStorageString(new Date());
    const storedDate=localStorage.getItem(selectedChapterDateKey(key));

    if(storedDate===todayStr){
        selectedChapterByKey[key]=localStorage.getItem(selectedChapterIdKey(key)) || null;
    }else{
        selectedChapterByKey[key]=null;
        localStorage.setItem(selectedChapterDateKey(key),todayStr);
        localStorage.removeItem(selectedChapterIdKey(key));
    }

}

function saveSelectedChapterForKey(key){

    localStorage.setItem(selectedChapterDateKey(key),dateToStorageString(new Date()));

    if(selectedChapterByKey[key]){
        localStorage.setItem(selectedChapterIdKey(key),selectedChapterByKey[key]);
    }else{
        localStorage.removeItem(selectedChapterIdKey(key));
    }

}

// Adds/removes the yellow tick on whichever row currently matches
// this key's selection. Cheap DOM class toggle rather than a full
// re-render, so it doesn't disturb an in-progress search or steal
// focus from the search input.
function refreshOpenChapterPopoverSelection(){

    const key=openChapterPopoverSubject;
    if(!key || !subjectChapterPopoverList) return;

    subjectChapterPopoverList.querySelectorAll("[data-chapter-id]").forEach((el)=>{
        el.classList.toggle("selected",el.getAttribute("data-chapter-id")===selectedChapterByKey[key]);
    });

    // covers the edge case where a key's timer is started (locking
    // its chapter) while that same key's popover is still open —
    // e.g. via a second click that lands on Start/Pause behind it
    if(subjectChapterPopover){
        const isLocked=pomodoroSessionLockedChapterKeys.has(key);
        subjectChapterPopover.classList.toggle("sessionLocked",isLocked);
        if(subjectChapterPopoverLockNote){
            subjectChapterPopoverLockNote.classList.toggle("hidden",!isLocked);
        }
    }

}

// Enables/disables a timer's Start/Pause button based on whether
// that key has a selection yet, and keeps that key's chapter button
// ring in sync (see .chapterSelected in pomodoro.css). Left alone
// while the timer is already running, so pausing an in-progress
// session never gets blocked by this — only *starting* a fresh one
// requires a selection.
function updateStartButtonGating(key){

    const btn=document.getElementById(key+"StartPauseBtn");

    const chapterBtn=document.getElementById(key+"ChapterBtn");
    if(chapterBtn){
        chapterBtn.classList.toggle("chapterSelected",!!selectedChapterByKey[key]);
        // locked doesn't disable the button — the popover still opens
        // to show what's selected, it just can't be changed inside it
        // (see the popover's click handler) — this class is purely a
        // visual cue
        chapterBtn.classList.toggle(
            "chapterLocked",
            pomodoroSessionLockedChapterKeys.has(key)
        );
    }

    if(!btn) return;

    const timer=subjectTimers[key] || sundayTaskTimers[key];
    const isRunning=timer ? timer.running : false;
    const needsSelection=!selectedChapterByKey[key] && !isRunning;

    btn.classList.toggle("needsChapter",needsSelection);

    if(needsSelection){
        btn.setAttribute("aria-disabled","true");
    }else{
        btn.removeAttribute("aria-disabled");
    }

}

// Nudges the person toward picking something: opens that key's
// chapter/test-type popover (if it isn't already open) and gives the
// Start/Pause button a brief yellow pulse, instead of just silently
// ignoring the click.
function promptChapterSelection(key){

    const chapterBtn=subjectChapterBtns[key];

    if(chapterBtn && !chapterBtn.disabled && openChapterPopoverSubject!==key){
        openSubjectChapterPopover(key,chapterBtn);
    }

    const startBtn=document.getElementById(key+"StartPauseBtn");

    if(startBtn){
        startBtn.classList.remove("chapterPulse");
        void startBtn.offsetWidth; // restart the animation on repeat clicks
        startBtn.classList.add("chapterPulse");
    }

}

// Keyed by weekday subject (physics/chemistry/maths) AND now also by
// the 3 Sunday task boxes — Bookmark Questions/Revision get a
// combined all-subjects chapter list, Mock Test gets its own fixed
// 3-option list. All 6 share the one popover element + open/close/
// positioning logic below; only the title/body/container-tint differ
// per key (see openSubjectChapterPopover()).
const subjectChapterBtns={
    physics:document.getElementById("physicsChapterBtn"),
    chemistry:document.getElementById("chemistryChapterBtn"),
    maths:document.getElementById("mathsChapterBtn"),
    mockTest:document.getElementById("mockTestChapterBtn"),
    bookmark:document.getElementById("bookmarkChapterBtn"),
    revision:document.getElementById("revisionChapterBtn")
};

// Matches the CSS's fixed width/max-height — used to position the
// popover before it's actually shown, so there's no flash-then-jump
// from measuring a freshly-unhidden element.
const SUBJECT_CHAPTER_POPOVER_WIDTH=230;
const SUBJECT_CHAPTER_POPOVER_MAX_HEIGHT=260;

let openChapterPopoverSubject=null;

function closeSubjectChapterPopover(){

    if(!subjectChapterPopover) return;

    subjectChapterPopover.classList.add("hidden");
    subjectChapterPopover.classList.remove("physics","chemistry","maths","sundayPopover");
    openChapterPopoverSubject=null;

}

// ---- chapter search (weekday subject popover + combined Bookmark/
// Revision popover) ----
// Matches if ANY word in the chapter name starts with the typed
// text — so "S" surfaces every chapter with a word starting S, and
// "SA" narrows that down to chapters whose first word starts SA
// *or* whose second (or any later) word starts SA. Case-insensitive.
function chapterMatchesSearch(name,searchTerm){

    const q=(searchTerm||"").trim().toLowerCase();
    if(!q) return true;

    return name.toLowerCase().split(/\s+/).some(word=>word.startsWith(q));

}

// Rendered once per popover open, then left alone — only the
// #subjectChapterPopoverItems div underneath gets its innerHTML
// swapped on each keystroke, so the input itself is never recreated
// and never loses focus/cursor position while typing.
const SUBJECT_CHAPTER_SEARCH_HTML=`
    <div class="subjectChapterPopoverSearchWrap">
        <svg class="subjectChapterPopoverSearchIcon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/>
            <path d="M20.5 20.5l-3.6-3.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <input type="text"
               id="subjectChapterPopoverSearchInput"
               class="subjectChapterPopoverSearchInput"
               placeholder="Search chapter..."
               autocomplete="off"
               spellcheck="false">
    </div>
`;

// Wires the just-rendered search input (see SUBJECT_CHAPTER_SEARCH_HTML
// above) up to a builder function that turns the current search text
// into the filtered items HTML for #subjectChapterPopoverItems.
function wireSubjectChapterSearch(buildItemsHtml){

    const input=document.getElementById("subjectChapterPopoverSearchInput");
    const itemsWrap=document.getElementById("subjectChapterPopoverItems");

    if(!input || !itemsWrap) return;

    input.addEventListener("input",()=>{
        itemsWrap.innerHTML=buildItemsHtml(input.value);
        refreshOpenChapterPopoverSelection();
    });

}

function buildSubjectChapterItemsHtml(subject,searchTerm){

    // `chapters` is script.js's global chapter array (same one the
    // main timeline is drawn from) — no separate copy kept here.
    const subjectChapters=chapters
        .filter(ch=>ch.subject===subject)
        .filter(ch=>chapterMatchesSearch(ch.name,searchTerm));

    if(!subjectChapters.length){
        return `<div class="subjectChapterPopoverEmpty">${
            searchTerm && searchTerm.trim() ? "No matching chapters." : "No chapters added yet."
        }</div>`;
    }

    // Same day-range logic the main timeline draws chapters with
    // (Sundays skipped) — used here just to flag whichever chapter
    // covers today, so it can be lightly highlighted below.
    const todayDay=getTodayPlannerDay();

    return subjectChapters.map(ch=>{

        let isToday=false;
        try{
            isToday=getStudyPositions(ch.start,ch.duration).includes(todayDay);
        }catch(e){
            isToday=false;
        }

        return `
            <div class="subjectChapterPopoverItem" data-chapter-id="${escapeAttr(ch.name)}">
                <span class="subjectChapterPopoverItemName${isToday ? " todayChapter" : ""}">${ch.name}</span>
                <span class="subjectChapterPopoverItemTick" aria-hidden="true">
                    <svg viewBox="0 0 16 16"><path d="M3 8.5L6.5 12L13 4"/></svg>
                </span>
            </div>
        `;

    }).join("");

}

function renderSubjectChapterList(subject){

    if(!subjectChapterPopoverList) return;

    subjectChapterPopoverList.innerHTML=
        SUBJECT_CHAPTER_SEARCH_HTML+
        `<div id="subjectChapterPopoverItems">${buildSubjectChapterItemsHtml(subject,"")}</div>`;

    wireSubjectChapterSearch(term=>buildSubjectChapterItemsHtml(subject,term));

}

// Bookmark Questions / Revision — same chapter source as the
// weekday subject popovers above (script.js's global `chapters`
// array, unfiltered by subject this time), rendered the same way,
// just merged across physics/chemistry/maths into one list. Each
// item gets a small subject-coloured dot so it's still clear which
// subject a chapter belongs to once they're mixed together.
//
// Always prefixed with one fixed "Combined" entry (NOT sourced from
// `chapters`) — a stand-in for "don't tie this session to one single
// chapter", styled larger/bolder with a yellow highlight so it
// stands out from the real chapters below it. Purely a visual entry
// for now; no click/selection behavior wired up yet.
const COMBINED_CHAPTER_OPTION_HTML=`
    <div class="subjectChapterPopoverItem combinedChapterItem" data-chapter-id="${COMBINED_CHAPTER_ID}">
        <span class="subjectChapterPopoverItemName combinedChapterName">Combined</span>
        <span class="subjectChapterPopoverItemTick" aria-hidden="true">
            <svg viewBox="0 0 16 16"><path d="M3 8.5L6.5 12L13 4"/></svg>
        </span>
    </div>
`;

function buildCombinedChapterItemsHtml(searchTerm){

    const allChapters=chapters
        .filter(ch=>ch.subject==="physics" || ch.subject==="chemistry" || ch.subject==="maths")
        .filter(ch=>chapterMatchesSearch(ch.name,searchTerm));

    if(!allChapters.length){
        return `<div class="subjectChapterPopoverEmpty">${
            searchTerm && searchTerm.trim() ? "No matching chapters." : "No chapters added yet."
        }</div>`;
    }

    const todayDay=getTodayPlannerDay();

    return allChapters.map(ch=>{

        let isToday=false;
        try{
            isToday=getStudyPositions(ch.start,ch.duration).includes(todayDay);
        }catch(e){
            isToday=false;
        }

        return `
            <div class="subjectChapterPopoverItem" data-chapter-id="${escapeAttr(ch.subject+"::"+ch.name)}">
                <span class="subjectChapterPopoverItemDot ${ch.subject}"></span>
                <span class="subjectChapterPopoverItemName${isToday ? " todayChapter "+ch.subject : ""}">${ch.name}</span>
                <span class="subjectChapterPopoverItemTick" aria-hidden="true">
                    <svg viewBox="0 0 16 16"><path d="M3 8.5L6.5 12L13 4"/></svg>
                </span>
            </div>
        `;

    }).join("");

}

function renderCombinedChapterList(){

    if(!subjectChapterPopoverList) return;

    // Combined box first (unaffected by search), then the search
    // bar, then the filtered chapter list underneath it.
    subjectChapterPopoverList.innerHTML=
        COMBINED_CHAPTER_OPTION_HTML+
        SUBJECT_CHAPTER_SEARCH_HTML+
        `<div id="subjectChapterPopoverItems">${buildCombinedChapterItemsHtml("")}</div>`;

    wireSubjectChapterSearch(term=>buildCombinedChapterItemsHtml(term));

}

// Mock Test — not sourced from `chapters` at all, just this one
// fixed 3-option list.
const MOCK_TEST_POPOVER_OPTIONS=["Mains Test","Advance Mock","Partial Mock"];

function renderMockTestOptionList(){

    if(!subjectChapterPopoverList) return;

    subjectChapterPopoverList.innerHTML=MOCK_TEST_POPOVER_OPTIONS.map(name=>`
        <div class="subjectChapterPopoverItem" data-chapter-id="${escapeAttr(name)}">
            <span class="subjectChapterPopoverItemName">${name}</span>
            <span class="subjectChapterPopoverItemTick" aria-hidden="true">
                <svg viewBox="0 0 16 16"><path d="M3 8.5L6.5 12L13 4"/></svg>
            </span>
        </div>
    `).join("");

}

function openSubjectChapterPopover(key,btn){

    if(!subjectChapterPopover || !btn) return;

    const isWeekdaySubject=subjectTimers[key]!==undefined;

    // Make it visible and tagged first — before any rendering/
    // positioning math runs — so a problem in either of those can't
    // leave the popover silently stuck hidden.
    subjectChapterPopover.classList.remove("hidden");
    subjectChapterPopover.classList.remove("physics","chemistry","maths","sundayPopover");
    subjectChapterPopover.classList.add(isWeekdaySubject ? key : "sundayPopover");
    openChapterPopoverSubject=key;

    // once this key's chapter has been used to start a timer this
    // session, the list is still viewable but nothing in it can be
    // picked — see the popover's delegated click handler below
    const isLocked=pomodoroSessionLockedChapterKeys.has(key);
    subjectChapterPopover.classList.toggle("sessionLocked",isLocked);

    if(subjectChapterPopoverLockNote){
        subjectChapterPopoverLockNote.classList.toggle("hidden",!isLocked);
    }

    if(subjectChapterPopoverTitle){

        if(isWeekdaySubject){
            subjectChapterPopoverTitle.textContent=capitalizeSubject(key)+" Chapters";
        }else if(key==="mockTest"){
            subjectChapterPopoverTitle.textContent=SUNDAY_TASK_LABELS[key];
        }else{
            subjectChapterPopoverTitle.textContent=SUNDAY_TASK_LABELS[key]+" — All Chapters";
        }

    }

    try{

        if(isWeekdaySubject){
            renderSubjectChapterList(key);
        }else if(key==="mockTest"){
            renderMockTestOptionList();
        }else{
            renderCombinedChapterList();
        }

    }catch(e){
        if(subjectChapterPopoverList){
            subjectChapterPopoverList.innerHTML=
                `<div class="subjectChapterPopoverEmpty">Couldn't load chapters.</div>`;
        }
    }

    refreshOpenChapterPopoverSelection();

    const rect=btn.getBoundingClientRect();

    // Prefer opening to the right of the button; flip to the left if
    // it would run off the viewport's right edge.
    let left=rect.right+10;
    if(left+SUBJECT_CHAPTER_POPOVER_WIDTH>window.innerWidth-8){
        left=rect.left-SUBJECT_CHAPTER_POPOVER_WIDTH-10;
    }

    let top=rect.top+rect.height/2-SUBJECT_CHAPTER_POPOVER_MAX_HEIGHT/2;
    top=Math.max(8,Math.min(top,window.innerHeight-SUBJECT_CHAPTER_POPOVER_MAX_HEIGHT-8));

    subjectChapterPopover.style.left=left+"px";
    subjectChapterPopover.style.top=top+"px";

}

Object.entries(subjectChapterBtns).forEach(([key,btn])=>{

    if(!btn) return;

    btn.addEventListener("click",(e)=>{

        e.stopPropagation();

        if(btn.disabled) return;

        if(openChapterPopoverSubject===key){
            closeSubjectChapterPopover();
        }else{
            openSubjectChapterPopover(key,btn);
        }

    });

});

// Clicking a chapter/test-type row selects it — one delegated
// listener on the popover itself, so it keeps working across every
// re-render (search filtering, reopening for a different subject)
// without needing to be rewired each time. Clicking the
// already-selected row again deselects it (locking Start/Pause back
// up), rather than requiring a different row to swap to.
if(subjectChapterPopover){

    subjectChapterPopover.addEventListener("click",(e)=>{

        const item=e.target.closest(".subjectChapterPopoverItem[data-chapter-id]");
        if(!item) return;

        const key=openChapterPopoverSubject;
        if(!key) return;

        e.stopPropagation();

        // once this key started a timer this session, its chapter is
        // fixed until the session ends (completes, or is reset via
        // the grace countdown/"End Session") — nudge instead of
        // silently doing nothing, same pattern as promptChapterSelection()
        if(pomodoroSessionLockedChapterKeys.has(key)){

            if(subjectChapterPopoverLockNote){
                subjectChapterPopoverLockNote.classList.remove("hidden");
                subjectChapterPopoverLockNote.classList.remove("lockNotePulse");
                void subjectChapterPopoverLockNote.offsetWidth;
                subjectChapterPopoverLockNote.classList.add("lockNotePulse");
            }

            return;

        }

        const chapterId=item.getAttribute("data-chapter-id");
        selectedChapterByKey[key]=(selectedChapterByKey[key]===chapterId) ? null : chapterId;

        saveSelectedChapterForKey(key);
        updateStartButtonGating(key);
        refreshOpenChapterPopoverSelection();

    });

}

// clicking anywhere outside the popover (and outside the chapter
// buttons themselves) closes it
document.addEventListener("click",(e)=>{

    if(!subjectChapterPopover || subjectChapterPopover.classList.contains("hidden")) return;
    if(e.target.closest("#subjectChapterPopover")) return;
    if(e.target.closest(".subjectTimerChapterBtn")) return;

    closeSubjectChapterPopover();

});

function openPomodoroPanel(){

    pomodoroPanel.classList.remove("hidden");
    document.body.classList.add("pomodoroOpen");
    pomodoroBlock.setAttribute("aria-expanded","true");

    alignPomodoroSubjectTimers();

    window.addEventListener("resize",alignPomodoroSubjectTimers);
    window.addEventListener("scroll",alignPomodoroSubjectTimers,{passive:true});

}

function closePomodoroPanel(){

    pomodoroPanel.classList.add("hidden");
    document.body.classList.remove("pomodoroOpen");
    pomodoroBlock.setAttribute("aria-expanded","false");

    closePomodoroEditor();
    closePomodoroHistory();
    closeSubjectChapterPopover();

    // A completed session stays "full" and shows the congrats popup
    // while the panel is open, but once the panel is closed there's
    // no more reason to keep it around — reset it here so reopening
    // the panel always shows a clean 00:00:00 session ring with no
    // leftover popup, rather than the same completed state forever.
    if(pomodoroSessionCompleted){
        beginPomodoroSession();
    }

    window.removeEventListener("resize",alignPomodoroSubjectTimers);
    window.removeEventListener("scroll",alignPomodoroSubjectTimers);

}

pomodoroBlock.addEventListener("click",()=>{

    if(pomodoroPanel.classList.contains("hidden")){
        openPomodoroPanel();
    }else{
        closePomodoroPanel();
    }

});

pomodoroBlock.addEventListener("keydown",(e)=>{

    if(e.key!=="Enter" && e.key!==" ") return;

    e.preventDefault();
    pomodoroBlock.click();

});

// Only two ways to close the main panel now: re-clicking the sidebar
// Pomodoro block above (the same click that opens it), or the ×
// button that floats above the panel itself (see #pomodoroPanelCloseBtn
// in index.html/pomodoro.css). Clicking anywhere else outside the
// panel no longer closes it — that used to fire on things like the
// subject chapter popover's search box, which lives outside
// #pomodoroPanel and so read as "outside", closing the whole panel
// mid-search.
if(pomodoroPanelCloseBtn){

    pomodoroPanelCloseBtn.addEventListener("click",(e)=>{

        e.stopPropagation();
        closePomodoroPanel();

    });

}

document.addEventListener("keydown",(e)=>{

    if(e.key!=="Escape") return;

    if(pomodoroEditorPanel && pomodoroEditorPanel.classList.contains("open")){
        closePomodoroEditor();
        return;
    }

});

loadPomodoroToday();
updatePomodoroDisplay();
updatePomodoroDateDisplay();
updatePomodoroCircles();

// Setting the date text above can grow the Pomodoro block after
// script.js already measured/locked #sidebarSpacer, which pushes
// the Physics/Chemistry/Maths cards out of alignment with their
// timeline rows. Re-run the alignment now that the block's final
// height is known.
if(typeof alignSidebar==="function"){
    alignSidebar();
}

// ======================================================
// SUBJECT TIMERS
// Independent per-subject stopwatch, same daily-reset pattern
// as the main Pomodoro total above but tracked/persisted
// separately per subject. Each has its own Start/Pause button
// and doesn't feed the top circles (yet) — see the panel body
// comment in index.html for why.
// ======================================================

function subjectGoalKey(subject){

    return `subjectGoalSeconds_${subject}`;

}

// Loads TODAY's target: today's own saved snapshot if one exists
// (i.e. today's goal was already edited/locked in earlier today),
// otherwise the fixed per-subject default. This is what today's
// live goalSeconds gets initialized to — deliberately NOT read from
// a single non-date-scoped "standing" key, since that's what let a
// goal edited on one day keep getting reused as the default target
// on every following day instead of resetting to the real default.
function loadSubjectGoal(subject){

    const todayStr=dateToStorageString(new Date());
    const storedForToday=parseInt(
        localStorage.getItem(subjectGoalDateKey(subject,todayStr)),10
    );

    subjectTimers[subject].goalSeconds=isNaN(storedForToday)
        ? DEFAULT_SUBJECT_GOAL_SECONDS[subject]
        : storedForToday;

}

// Legacy/informational only now — subjectGoalKey is no longer read
// by loadSubjectGoal() or getSubjectGoalForDate() (see above), so it
// no longer drives what any day's target actually is. Left in place
// so an old saved value isn't silently discarded, but the per-day
// snapshots below are the real source of truth.
function saveSubjectGoal(subject){

    localStorage.setItem(subjectGoalKey(subject),String(subjectTimers[subject].goalSeconds));

}

// ---- per-day goal snapshots ----
// This is the real source of truth for what a given day's target
// is: one dated snapshot per subject per day, falling back to the
// fixed DEFAULT_SUBJECT_GOAL_SECONDS above when a day has none. That
// fallback means every unedited day — today, tomorrow, or any day in
// history — always shows the same fixed default instead of whatever
// value happened to be live elsewhere. Once a day's target is
// recorded (edited or auto-snapshotted), it doesn't move under it
// later even if the default or another day's goal changes.

function subjectGoalDateKey(subject,dateStr){

    return `subjectGoalSeconds_${subject}_${dateStr}`;

}

// Falls back to the fixed per-subject default if this particular day
// was never snapshotted — NOT the live standing goal, which just
// reflects whatever subject was last edited on some other day. Using
// the live value here was the bug: a goal change on one day would
// silently become the "target" shown on every day without a
// snapshot of its own, today or tomorrow, past or future.
function getSubjectGoalForDate(subject,dateStr){

    const stored=parseInt(localStorage.getItem(subjectGoalDateKey(subject,dateStr)),10);

    return isNaN(stored) ? DEFAULT_SUBJECT_GOAL_SECONDS[subject] : stored;

}

function saveSubjectGoalForDate(subject,dateStr){

    localStorage.setItem(
        subjectGoalDateKey(subject,dateStr),
        String(subjectTimers[subject].goalSeconds)
    );

}

// Called once per subject on load, right after loadSubjectGoal() has
// set today's live goalSeconds (today's own snapshot if it already
// existed, otherwise the fixed default). If today doesn't have a
// snapshot yet (first load of a new day), this locks that value in
// as today's recorded target — so a fresh day always locks in the
// fixed default, never a value carried over from some other day.
function ensureTodayGoalSnapshot(subject){

    const todayStr=dateToStorageString(new Date());

    if(localStorage.getItem(subjectGoalDateKey(subject,todayStr))===null){
        saveSubjectGoalForDate(subject,todayStr);
    }

}

// Sum of each subject's target for a given day — today's live goals
// if dateStr is today (or omitted), otherwise that day's saved
// snapshots (falling back to the live goal per-subject if a subject
// wasn't snapshotted that day).
function computeDayTargetSeconds(dateStr){

    if(!dateStr || dateStr===dateToStorageString(new Date())){
        return computeDailyTargetSeconds();
    }

    return Object.keys(subjectTimers).reduce(
        (sum,subject)=>sum+getSubjectGoalForDate(subject,dateStr),
        0
    );

}

function subjectDateKey(subject){

    return `subjectStudyDate_${subject}`;

}

function subjectSecondsKey(subject){

    return `subjectStudySeconds_${subject}`;

}

function loadSubjectToday(subject){

    const todayStr=dateToStorageString(new Date());
    const storedDate=localStorage.getItem(subjectDateKey(subject));

    subjectTimers[subject].activeDate=todayStr;

    if(storedDate===todayStr){

        const storedSeconds=parseInt(
            localStorage.getItem(subjectSecondsKey(subject)),10
        );

        subjectTimers[subject].seconds=isNaN(storedSeconds) ? 0 : storedSeconds;

    }else{

        subjectTimers[subject].seconds=0;

        localStorage.setItem(subjectDateKey(subject),todayStr);
        localStorage.setItem(subjectSecondsKey(subject),"0");

    }

}

// Always writes under this subject's pinned activeDate rather than
// re-deriving "today" via new Date() — see loadSubjectToday() above.
function saveSubjectToday(subject){

    localStorage.setItem(subjectDateKey(subject),subjectTimers[subject].activeDate);
    localStorage.setItem(subjectSecondsKey(subject),String(subjectTimers[subject].seconds));

}

function formatSubjectGoalTag(totalSeconds){

    const hrs=Math.floor(totalSeconds/3600);
    const mins=Math.round((totalSeconds%3600)/60);

    return `(TG- ${String(hrs).padStart(2,"0")}:${String(mins).padStart(2,"0")})`;

}

// overrideSeconds lets a caller show a specific total instead of the
// live subjectTimers value — used when the history calendar is
// showing a past day (see syncMainPanelToHistoryDate()). overrideGoalSeconds
// does the same for the goal denominator, since a past day's target
// may differ from today's live goal (see the per-day goal snapshots
// above) — omit it to fall back to the live goal, which is what
// today's view (and any pre-snapshot history) wants.
function updateSubjectDisplay(subject,overrideSeconds,overrideGoalSeconds){

    const timeEl=document.getElementById(subject+"TimerDisplay");
    const goalTagEl=document.getElementById(subject+"GoalTag");
    const barEl=document.getElementById(subject+"TimerBarFill");
    const completedTagEl=document.getElementById(subject+"CompletedTag");

    const seconds=(overrideSeconds===undefined || overrideSeconds===null)
        ? subjectTimers[subject].seconds
        : overrideSeconds;

    const goalSeconds=(overrideGoalSeconds===undefined || overrideGoalSeconds===null)
        ? subjectTimers[subject].goalSeconds
        : overrideGoalSeconds;

    if(timeEl){
        timeEl.textContent=formatPomodoroTime(seconds);
    }

    if(goalTagEl){
        goalTagEl.textContent=formatSubjectGoalTag(goalSeconds);
    }

    if(barEl){

        const pct=Math.max(0,Math.min(100,
            (seconds/goalSeconds)*100
        ));

        barEl.style.width=pct+"%";

    }

    if(completedTagEl){
        completedTagEl.classList.toggle("hidden",!(goalSeconds>0 && seconds>=goalSeconds));
    }

}

// True if ANY tracked timer is running — a weekday subject or a
// Sunday task alike. Used in place of a subjectTimers-only check so
// the shared session/grace/top-ring logic below treats both kinds of
// timer as one pool (they're never actually running at the same
// time in the UI, since the two rows swap per day, but the checks
// stay correct either way).
function isAnyTrackedTimerRunning(){

    return Object.values(subjectTimers).some(t=>t.running) ||
        Object.values(sundayTaskTimers).some(t=>t.running);

}

function startSubjectTimer(subject){

    const timer=subjectTimers[subject];

    if(timer.running) return;

    const wasAnySubjectRunning=isAnyTrackedTimerRunning();

    // only one subject runs at a time — pause any other running one first
    Object.keys(subjectTimers).forEach((other)=>{

        if(other!==subject && subjectTimers[other].running){
            pauseSubjectTimer(other);
        }

    });

    // resuming inside the grace window picks the session back up
    // unchanged; only a fully idle restart with no grace pending
    // (i.e. the countdown already ran out, or there was nothing to
    // protect in the first place) starts a genuinely new session
    if(pomodoroSessionGraceActive){
        clearPomodoroSessionGrace();
    }else if(!wasAnySubjectRunning){
        beginPomodoroSession();
    }

    timer.running=true;

    // the chapter it's starting with is now fixed for the rest of
    // this session — see pomodoroSessionLockedChapterKeys above
    pomodoroSessionLockedChapterKeys.add(subject);
    updateStartButtonGating(subject);
    if(openChapterPopoverSubject===subject) refreshOpenChapterPopoverSelection();

    const btn=document.getElementById(subject+"StartPauseBtn");

    if(btn){
        btn.classList.add("running");
        btn.setAttribute("aria-label","Pause "+subject+" timer");
    }

    timer.startTimestamp=Date.now();
    timer.baseSeconds=timer.seconds;

    timer.intervalId=setInterval(()=>tickSubjectTimer(subject),1000);

    // the top rings only ever run because a subject is running
    startPomodoroTimer();

}

// Recomputes timer.seconds from real elapsed time since this run
// started, rather than trusting the interval to have fired once per
// second — see the REAL-TIME TICK TRACKING note near the top of this
// file. This is what actually fixes the "50 minutes in another tab
// only recorded as 2-3" bug: a throttled interval now still lands on
// the correct total the moment it does fire, instead of having only
// counted the handful of ticks that survived the throttling.
function tickSubjectTimer(subject){

    const timer=subjectTimers[subject];

    if(!timer.running) return;

    const newSeconds=timer.baseSeconds+elapsedRealSeconds(timer.startTimestamp);
    const delta=newSeconds-timer.seconds;

    if(delta<=0) return;

    timer.seconds=newSeconds;
    saveSubjectToday(subject);

    // if the history calendar is showing a past day, this subject's
    // row is frozen on that day's recorded total — don't let a live
    // tick from a still-running timer overwrite it. The seconds
    // still accumulate underneath either way.
    if(!isBrowsingPastHistoryDate()){
        updateSubjectDisplay(subject);
    }

    // Only credit this tick to the session's subject breakdown while
    // still in the study phase — once the break has started, ticks
    // from a timer left running shouldn't be logged against a subject
    // in history. The break's own time is already shown separately,
    // via the study:break ratio box, so it needs no entry here.
    if(!isPomodoroStudyPhaseDone()){
        pomodoroSessionSubjectSeconds.set(
            subject,
            (pomodoroSessionSubjectSeconds.get(subject) || 0)+delta
        );
    }

}

function pauseSubjectTimer(subject,options={}){

    const timer=subjectTimers[subject];

    if(!timer.running) return;

    // catch up on any elapsed real time since the last tick fired
    // (matters if the interval got throttled) before freezing seconds
    tickSubjectTimer(subject);

    timer.running=false;
    timer.startTimestamp=null;

    const btn=document.getElementById(subject+"StartPauseBtn");

    if(btn){
        btn.classList.remove("running");
        btn.setAttribute("aria-label","Start "+subject+" timer");
    }

    clearInterval(timer.intervalId);
    timer.intervalId=null;

    saveSubjectToday(subject);

    // stop the top rings once no subject is running anymore, and
    // give the session a grace window before it resets — unless this
    // pause is part of the session completing on its own, in which
    // case there's nothing to grace-period, it's just done
    const anySubjectRunning=isAnyTrackedTimerRunning();

    if(!anySubjectRunning){

        pausePomodoroTimer();

        if(!options.skipGrace){

            // study's already done — the break was optional, so
            // pausing here just ends the session as "completed" on
            // the spot instead of opening the usual 30s grace window
            if(isPomodoroStudyPhaseDone()){
                endPomodoroSessionAfterStudyDone();
            }else{
                startPomodoroSessionGrace();
            }

        }

    }

}

["physics","chemistry","maths"].forEach((subject)=>{

    loadSubjectGoal(subject);
    ensureTodayGoalSnapshot(subject);
    loadSubjectToday(subject);
    updateSubjectDisplay(subject);
    loadSelectedChapterForKey(subject);
    updateStartButtonGating(subject);

    const btn=document.getElementById(subject+"StartPauseBtn");

    if(btn){

        btn.addEventListener("click",()=>{

            if(btn.classList.contains("historyDisabled")) return;

            if(subjectTimers[subject].running){
                pauseSubjectTimer(subject);
            }else if(!selectedChapterByKey[subject]){
                // a chapter has to be picked from this subject's
                // popover before a fresh session can start
                promptChapterSelection(subject);
            }else{
                startSubjectTimer(subject);
            }

        });

    }

});

// ======================================================
// SUNDAY TASK BOXES — Mock Test / Bookmark Questions / Revision
// ======================================================
// These 3 boxes stand in for physics/chemistry/maths on Sundays (see
// updateSundayMode()). They don't have a daily goal or a completed
// tag/bar — Sundays are "free" — but otherwise they act exactly like
// a weekday subject timer: independent day-scoped seconds, one
// running at a time, driving the same shared top-ring/session/grace/
// congrats machinery as subjectTimers, and logging into session
// history the same way (their seconds land in
// pomodoroSessionSubjectSeconds under their task key, so
// buildHistoryEntry() picks them up with no changes needed there).

function sundayTaskDateKey(task){

    return `sundayTaskStudyDate_${task}`;

}

function sundayTaskSecondsKey(task){

    return `sundayTaskStudySeconds_${task}`;

}

function loadSundayTaskToday(task){

    const todayStr=dateToStorageString(new Date());
    const storedDate=localStorage.getItem(sundayTaskDateKey(task));

    sundayTaskTimers[task].activeDate=todayStr;

    if(storedDate===todayStr){

        const storedSeconds=parseInt(
            localStorage.getItem(sundayTaskSecondsKey(task)),10
        );

        sundayTaskTimers[task].seconds=isNaN(storedSeconds) ? 0 : storedSeconds;

    }else{

        sundayTaskTimers[task].seconds=0;

        localStorage.setItem(sundayTaskDateKey(task),todayStr);
        localStorage.setItem(sundayTaskSecondsKey(task),"0");

    }

}

// Always writes under this task's pinned activeDate rather than
// re-deriving "today" via new Date() — see loadSundayTaskToday() above.
function saveSundayTaskToday(task){

    localStorage.setItem(sundayTaskDateKey(task),sundayTaskTimers[task].activeDate);
    localStorage.setItem(sundayTaskSecondsKey(task),String(sundayTaskTimers[task].seconds));

}

// overrideSeconds mirrors updateSubjectDisplay()'s — used when the
// history calendar is showing a past Sunday (see
// syncMainPanelToHistoryDate()) to freeze the box on that day's
// logged total instead of the live in-memory one.
function updateSundayTaskDisplay(task,overrideSeconds){

    const timeEl=document.getElementById(task+"TimerDisplay");

    const seconds=(overrideSeconds===undefined || overrideSeconds===null)
        ? sundayTaskTimers[task].seconds
        : overrideSeconds;

    if(timeEl){
        timeEl.textContent=formatPomodoroTime(seconds);
    }

}

// Same read-only treatment as setSubjectTimerLocked() above, applied
// to a Sunday task box's Start/Pause + chapter-style button while a
// past day is being browsed in the history calendar.
function setSundayTaskLocked(task,locked){

    const label=SUNDAY_TASK_LABELS[task];

    const btn=document.getElementById(task+"StartPauseBtn");
    if(btn){
        btn.classList.toggle("historyDisabled",locked);
        btn.disabled=locked;
        btn.setAttribute("aria-label",
            locked ? "Timer locked — viewing a past day" : "Start "+label+" timer"
        );
    }

    const chapterBtn=document.getElementById(task+"ChapterBtn");
    if(chapterBtn){
        chapterBtn.classList.toggle("historyDisabled",locked);
        chapterBtn.disabled=locked;
        chapterBtn.setAttribute("aria-label",
            locked ? label+" chapters locked — viewing a past day" : label+" chapters"
        );
        // a locked task's popover shouldn't stay open behind it
        if(locked && openChapterPopoverSubject===task){
            closeSubjectChapterPopover();
        }
    }

    // re-sync the chapter-required styling once Start/Pause is
    // usable again (leaving history view back to today)
    if(!locked){
        updateStartButtonGating(task);
    }

}

// Rebuilds a past Sunday's per-task totals the same way
// computeHistoryDaySubjectTotals() does for weekday subjects — by
// summing that day's logged sessions' breakdowns, since only the
// session log (not a running per-task total) is persisted per day.
function computeHistoryDaySundayTaskTotals(dateStr){

    const totals={mockTest:0,bookmark:0,revision:0};

    loadHistoryLogForDate(dateStr).forEach((entry)=>{

        (entry.subjects || []).forEach(({subject,seconds})=>{

            if(totals[subject]!==undefined){
                totals[subject]+=seconds;
            }

        });

    });

    return totals;

}

function startSundayTask(task){

    const timer=sundayTaskTimers[task];

    if(timer.running) return;

    const wasAnyRunning=isAnyTrackedTimerRunning();

    // only one Sunday task runs at a time — pause any other running one first
    Object.keys(sundayTaskTimers).forEach((other)=>{

        if(other!==task && sundayTaskTimers[other].running){
            pauseSundayTask(other);
        }

    });

    // resuming inside the grace window picks the session back up
    // unchanged; only a fully idle restart with no grace pending
    // starts a genuinely new session — same rule as startSubjectTimer()
    if(pomodoroSessionGraceActive){
        clearPomodoroSessionGrace();
    }else if(!wasAnyRunning){
        beginPomodoroSession();
    }

    timer.running=true;

    // the chapter/test-type it's starting with is now fixed for the
    // rest of this session — see pomodoroSessionLockedChapterKeys above
    pomodoroSessionLockedChapterKeys.add(task);
    updateStartButtonGating(task);
    if(openChapterPopoverSubject===task) refreshOpenChapterPopoverSelection();

    const btn=document.getElementById(task+"StartPauseBtn");
    const label=SUNDAY_TASK_LABELS[task];

    if(btn){
        btn.classList.add("running");
        btn.setAttribute("aria-label","Pause "+label+" timer");
    }

    timer.startTimestamp=Date.now();
    timer.baseSeconds=timer.seconds;

    timer.intervalId=setInterval(()=>tickSundayTask(task),1000);

    // the top rings only ever run because a subject/task is running
    startPomodoroTimer();

}

// Same real-elapsed-time recompute as tickSubjectTimer() above,
// applied to Sunday tasks.
function tickSundayTask(task){

    const timer=sundayTaskTimers[task];

    if(!timer.running) return;

    const newSeconds=timer.baseSeconds+elapsedRealSeconds(timer.startTimestamp);
    const delta=newSeconds-timer.seconds;

    if(delta<=0) return;

    timer.seconds=newSeconds;
    saveSundayTaskToday(task);

    if(!isBrowsingPastHistoryDate()){
        updateSundayTaskDisplay(task);
    }

    // Same rule as tickSubjectTimer() above — don't log break-time
    // ticks against a task in the session's history breakdown.
    if(!isPomodoroStudyPhaseDone()){
        pomodoroSessionSubjectSeconds.set(
            task,
            (pomodoroSessionSubjectSeconds.get(task) || 0)+delta
        );
    }

}

function pauseSundayTask(task,options={}){

    const timer=sundayTaskTimers[task];

    if(!timer.running) return;

    // catch up on any elapsed real time since the last tick fired
    // (matters if the interval got throttled) before freezing seconds
    tickSundayTask(task);

    timer.running=false;
    timer.startTimestamp=null;

    const btn=document.getElementById(task+"StartPauseBtn");
    const label=SUNDAY_TASK_LABELS[task];

    if(btn){
        btn.classList.remove("running");
        btn.setAttribute("aria-label","Start "+label+" timer");
    }

    clearInterval(timer.intervalId);
    timer.intervalId=null;

    saveSundayTaskToday(task);

    // stop the top rings once nothing is running anymore, and give
    // the session a grace window before it resets — unless this
    // pause is part of the session completing on its own
    const anyRunning=isAnyTrackedTimerRunning();

    if(!anyRunning){

        pausePomodoroTimer();

        if(!options.skipGrace){

            // same rule as pauseSubjectTimer() above — once study's
            // done the break is optional, so this just ends the
            // session as "completed" immediately, no grace window
            if(isPomodoroStudyPhaseDone()){
                endPomodoroSessionAfterStudyDone();
            }else{
                startPomodoroSessionGrace();
            }

        }

    }

}

Object.keys(sundayTaskTimers).forEach((task)=>{

    loadSundayTaskToday(task);
    updateSundayTaskDisplay(task);
    loadSelectedChapterForKey(task);
    updateStartButtonGating(task);

    const btn=document.getElementById(task+"StartPauseBtn");

    if(btn){

        btn.addEventListener("click",()=>{

            if(btn.classList.contains("historyDisabled")) return;

            if(sundayTaskTimers[task].running){
                pauseSundayTask(task);
            }else if(!selectedChapterByKey[task]){
                // Mock Test needs one of its 3 test types picked;
                // Bookmark/Revision need a chapter (or "Combined")
                // picked — same requirement as the weekday subjects
                promptChapterSelection(task);
            }else{
                startSundayTask(task);
            }

        });

    }

});

// the earlier updatePomodoroCircles()/updateSessionPhaseVisuals() calls
// above ran before subject goals were loaded from localStorage — now
// that they're in, refresh so today's target and the ticking icons
// reflect any saved custom goals right away instead of only after the
// next tick
updatePomodoroCircles();
updateSessionPhaseVisuals();
// ======================================================
// VISIBILITY CATCH-UP
// The tick functions above already compute correct totals from real
// elapsed time whenever they fire, throttled or not — that alone
// fixes the recording bug. This listener is a UX top-up: it forces
// an immediate recompute the instant the tab becomes visible again,
// so the numbers on screen are already correct as soon as you look
// at them instead of waiting on the next (possibly still-throttled
// for a moment) interval tick to catch them up.
// ======================================================
document.addEventListener("visibilitychange",()=>{

    if(document.visibilityState!=="visible") return;

    if(pomodoroRunning) tickPomodoroTimer();

    Object.keys(subjectTimers).forEach((subject)=>{
        if(subjectTimers[subject].running) tickSubjectTimer(subject);
    });

    Object.keys(sundayTaskTimers).forEach((task)=>{
        if(sundayTaskTimers[task].running) tickSundayTask(task);
    });

    if(pomodoroSessionGraceActive) tickPomodoroSessionGrace();

});

// ======================================================
// UNLOAD / REFRESH — END THE SESSION LIKE THE GRACE POPUP WOULD,
// AND WARN BEFORE IT HAPPENS
// A refresh or tab close already stops everything and the total
// timer's seconds survive fine (they're saved to localStorage on
// every tick). What was missing: mid-session progress never made it
// into the history log, because that only ever happened through
// pauseSubjectTimer()/pauseSundayTask() opening the grace popup and
// someone clicking its end button (endPomodoroSessionNow()), or the
// countdown running out on its own — none of which gets a chance to
// happen if the page itself is going away.
//
// Two separate things happen here, deliberately on two different
// events:
//   - beforeunload only ever asks the browser to show its native
//     "leave site?" confirmation. It must NOT log anything itself —
//     if it did, cancelling that prompt would still have reset the
//     session, even though the page never actually left.
//   - pagehide only fires once the page is actually going away (the
//     browser doesn't fire it if the beforeunload prompt was
//     cancelled), so the real catch-up-and-log work belongs there:
//     it catches up whatever timer was still running to the real
//     elapsed seconds (same as a pause would), then logs the session
//     as incomplete — exactly what a manual "pause, then hit the
//     grace popup's end button" would do.
// pomodoroUnloadHandled guards pagehide against firing this twice
// (e.g. visibilitychange->hidden then an actual unload in a row).
// ======================================================
let pomodoroUnloadHandled=false;

function isPomodoroSessionInProgress(){

    return !!pomodoroSessionStartTimestamp && !pomodoroSessionCompleted;

}

window.addEventListener("beforeunload",(e)=>{

    if(!isPomodoroSessionInProgress()) return;

    // Triggers the browser's own built-in warning dialog. Browsers
    // ignore any custom message and show their own fixed wording
    // ("Changes you made may not be saved" or similar) — that's a
    // browser security restriction, not something this code controls.
    e.preventDefault();
    e.returnValue="";

});

function handlePomodoroPageHide(){

    if(pomodoroUnloadHandled) return;

    // nothing to end if no session was ever started, or it already
    // finished on its own (completePomodoroSession() logs that case)
    if(!isPomodoroSessionInProgress()) return;

    pomodoroUnloadHandled=true;

    if(pomodoroRunning) tickPomodoroTimer();

    Object.keys(subjectTimers).forEach((subject)=>{
        if(subjectTimers[subject].running) tickSubjectTimer(subject);
    });

    Object.keys(sundayTaskTimers).forEach((task)=>{
        if(sundayTaskTimers[task].running) tickSundayTask(task);
    });

    // Same rule as endPomodoroSessionAfterStudyDone() above: once the
    // study portion is done, the break was always optional, so a
    // refresh/close mid-break should log the same "completed" entry
    // a manual pause would — not "incomplete" just because the break
    // itself got cut short.
    if(isPomodoroStudyPhaseDone()){
        logCompletedPomodoroSession(pomodoroSessionStartTimestamp,Date.now());
    }else{
        logAbandonedPomodoroSession();
    }

}

window.addEventListener("pagehide",handlePomodoroPageHide);



// STUDY PLANNER — PART 1: VARIABLES & TIMELINE

let DAY_WIDTH = 42;
let zoomPercent = 100;

// TIMELINE RANGE — start/end date are adjustable (stored in localStorage, editable via the header date-range button); TOTAL_DAYS is always derived from them, never stored separately

const DEFAULT_START_DATE = new Date(2026,7,1);
const DEFAULT_END_DATE = new Date(2026,11,18);

function dateToStorageString(d){
    return d.getFullYear()+"-"+
    String(d.getMonth()+1).padStart(2,"0")+"-"+
    String(d.getDate()).padStart(2,"0");
}

function storageStringToDate(s){
    if(!s) return null;
    const parts=s.split("-").map(Number);
    if(parts.length!==3 || parts.some(isNaN)) return null;
    return new Date(parts[0],parts[1]-1,parts[2]);
}

function loadStoredDate(key,fallback){
    return storageStringToDate(localStorage.getItem(key)) || fallback;
}

// Whole-day difference between two dates (b minus a), ignoring time-of-day

function daysDiff(a,b){
    const msPerDay=1000*60*60*24;
    const dayA=new Date(a.getFullYear(),a.getMonth(),a.getDate());
    const dayB=new Date(b.getFullYear(),b.getMonth(),b.getDate());
    return Math.round((dayB-dayA)/msPerDay);
}

// Day count between two dates, inclusive of both ends

function daysBetweenInclusive(from,to){
    return daysDiff(from,to)+1;
}

let startDate=
loadStoredDate("plannerStartDate",DEFAULT_START_DATE);

let endDate=
loadStoredDate("plannerEndDate",DEFAULT_END_DATE);

let TOTAL_DAYS=
Math.max(1,daysBetweenInclusive(startDate,endDate));

let chapters =
JSON.parse(localStorage.getItem("chapters")) || [];

// One-time cleanup: strip chapters with 0/invalid duration (draws a stray group border with no bar); duration must be 1+

chapters = chapters.filter(chapter=>(chapter.duration || 0)>=1);

localStorage.setItem("chapters", JSON.stringify(chapters));

let currentChapterIndex = -1;

// Sunday task checkboxes, keyed by planner day number, e.g. { "8": { revision:true } }
let sundayTasksData =
JSON.parse(localStorage.getItem("sundayTasks")) || {};

const weekdays=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

const timeline=document.getElementById("timeline");

const monthHeader=document.getElementById("monthHeader");
const dateHeader=document.getElementById("dateHeader");
const weekdayHeader=document.getElementById("weekdayHeader");
const sundayRow=document.getElementById("sundayRow");

const physicsRow=document.getElementById("physicsRow");
const chemistryRow=document.getElementById("chemistryRow");
const mathsRow=document.getElementById("mathsRow");
function updateTimelineWidth(){
    timeline.style.width =
    (TOTAL_DAYS * DAY_WIDTH + 40) + "px";
    document.documentElement.style.setProperty(
        "--dayWidth",
        DAY_WIDTH + "px"
    );
}
updateTimelineWidth();

// SIDEBAR ALIGNMENT — measures the actual rendered top of the Physics row vs the Physics sidebar box and sets the spacer to close the gap, so it stays correct at any zoom level/mode (replaces the old hardcoded 98px)

function alignSidebar(){
    const spacer=document.getElementById("sidebarSpacer");
    const physicsRow=document.getElementById("physicsRow");
    const physicsBox=document.querySelector(".subject.physics");
    if(!spacer || !physicsRow || !physicsBox) return;
    // Reset first so a stale spacer height doesn't skew the measurement, then measure after layout settles
    spacer.style.height="0px";
    requestAnimationFrame(()=>{
        const targetTop=physicsRow.getBoundingClientRect().top;
        const currentTop=physicsBox.getBoundingClientRect().top;
        const diff=Math.round(targetTop-currentTop);
        spacer.style.height=Math.max(0,diff)+"px";
    });
}

const zoomInBtn=document.getElementById("zoomInBtn");
const zoomOutBtn=document.getElementById("zoomOutBtn");

// WALLPAPER / NEON THEME TOGGLE BUTTONS — two independent icon buttons; each click flips its own state and applies immediately, no popup/commit step

const wallpaperBtn=document.getElementById("wallpaperBtn");
const neonBtn=document.getElementById("neonBtn");

let wallpaperHidden=
localStorage.getItem("wallpaperHidden")==="true";

let neonMode=
localStorage.getItem("neonMode")==="true";

function syncToggleBtn(btn,isOn){
    btn.classList.toggle("active",isOn);
    btn.setAttribute("aria-pressed",isOn);
}

function applyWallpaperMode(){
    document.body.classList.toggle("wallpaperHidden",wallpaperHidden);
}

function applyNeonMode(){
    document.body.classList.toggle("neonMode",neonMode);
}

applyWallpaperMode();
applyNeonMode();
syncToggleBtn(wallpaperBtn,!wallpaperHidden);
syncToggleBtn(neonBtn,neonMode);

wallpaperBtn.addEventListener("click",()=>{
    wallpaperHidden=!wallpaperHidden;
    localStorage.setItem("wallpaperHidden",wallpaperHidden);
    applyWallpaperMode();
    syncToggleBtn(wallpaperBtn,!wallpaperHidden);
});

neonBtn.addEventListener("click",()=>{
    neonMode=!neonMode;
    localStorage.setItem("neonMode",neonMode);
    applyNeonMode();
    syncToggleBtn(neonBtn,neonMode);
    drawChapters();
});

const zoomText=document.getElementById("zoomPercent");

// MONTH HEADER (grouped + sticky) — one wide div per month instead of per-day cells, so the label doesn't scroll away when day 1 leaves screen; uses position:sticky to hug the left edge until its month scrolls past

function getMonthLabel(dayIndex){
    const d=new Date(startDate);
    d.setDate(startDate.getDate()+dayIndex);
    return d.toLocaleString("default",{month:"long"})+" "+d.getFullYear();
}

function buildMonthHeader(){
    monthHeader.innerHTML="";
    let i=0;
    while(i<TOTAL_DAYS){
        const monthName=getMonthLabel(i);
        let count=1;
        while(
            i+count<TOTAL_DAYS &&
            getMonthLabel(i+count)===monthName
        ){
            count++;
        }
        const group=document.createElement("div");
        group.className="monthGroup";
        group.style.width=(count*DAY_WIDTH)+"px";
        const label=document.createElement("div");
        label.className="monthLabel";
        label.textContent=monthName;
        group.appendChild(label);
        monthHeader.appendChild(group);
        i+=count;
    }
}

function createTimeline(){
    dateHeader.innerHTML="";
    weekdayHeader.innerHTML="";
    sundayRow.innerHTML="";
    buildMonthHeader();
    // Real "today" planner-day index (1-based), so the highlight tracks the actual current date instead of always day 1
    const todayIndex=getTodayPlannerDay()-1;
    for(let i=0;i<TOTAL_DAYS;i++){
        const d=new Date(startDate);
        d.setDate(startDate.getDate()+i);
                // ---------------- DATE ----------------
        const dateCell=document.createElement("div");
        dateCell.textContent=d.getDate();
        if(i===todayIndex){
            dateCell.classList.add("todayCell");
        }
        // Only today and past days open the Pomodoro history for that
        // date — future days stay plain (not clickable/hoverable).
        if(i<=todayIndex){
            dateCell.classList.add("dateCellClickable");
            dateCell.setAttribute("role","button");
            dateCell.setAttribute("tabindex","0");
            dateCell.title="View Pomodoro history for this day";
            const historyDateStr=dateToStorageString(d);
            const openHistoryForThisDate=(e)=>{
                // Stop this click reaching document — the history
                // drawer has a document-level "click outside closes it"
                // listener that would otherwise fire right after we
                // open it (same click event) and immediately close it.
                if(e) e.stopPropagation();
                if(pomodoroPanel.classList.contains("hidden")){
                    openPomodoroPanel();
                }
                openPomodoroHistory();
                renderPomodoroHistory(historyDateStr);
            };
            dateCell.addEventListener("click",openHistoryForThisDate);
            dateCell.addEventListener("keydown",(e)=>{
                if(e.key==="Enter" || e.key===" "){
                    e.preventDefault();
                    openHistoryForThisDate(e);
                }
            });
        }
        dateHeader.appendChild(dateCell);
        // ---------------- WEEKDAY ----------------
        const weekCell=document.createElement("div");
        weekCell.textContent=
        weekdays[(d.getDay()+6)%7];
        weekdayHeader.appendChild(weekCell);
        // ---------------- SUNDAY ----------------
        if(d.getDay()===0){
            const dayNumber=i+1;
            const saved=sundayTasksData[dayNumber] || {};
            const sunday=document.createElement("div");
            sunday.className="sundayTask";
            sunday.style.left=((i*DAY_WIDTH)-1)+"px";
            sunday.style.width=DAY_WIDTH+"px";
            sunday.innerHTML=`
                <label class="sundayTaskItem">
                    <input type="checkbox" data-task="revision" ${saved.revision?"checked":""}>
                    <span>Notes Revision</span>
                </label>

                <label class="sundayTaskItem">
                    <input type="checkbox" data-task="mock" ${saved.mock?"checked":""}>
                    <span>Mock Test</span>
                </label>

                <label class="sundayTaskItem">
                    <input type="checkbox" data-task="bookmarks" ${saved.bookmarks?"checked":""}>
                    <span>Bookmarked Questions</span>
                </label>
            `;
            sunday.querySelectorAll("input[type=checkbox]")
                .forEach(box=>{
                box.addEventListener("change",()=>{
                    if(!sundayTasksData[dayNumber]){
                        sundayTasksData[dayNumber]={};
                    }
                    sundayTasksData[dayNumber][box.dataset.task]=
                    box.checked;
                    localStorage.setItem(
                        "sundayTasks",
                        JSON.stringify(sundayTasksData)
                    );
                });
            });
            sundayRow.appendChild(sunday);
        }
    }
}

createTimeline();

// START DATE PICKER — native calendar input like the Timeline Range panel; chapters can be dated 2026–2027 (min/max on the inputs in index.html) independent of the visible timeline range

const CHAPTER_DATE_MIN=new Date(2026,0,1);
const CHAPTER_DATE_MAX=new Date(2027,11,31);

// Converts a chapter's stored day-number (1-based, relative to startDate) into an actual Date

function dayNumberToDate(dayNumber){
    const d=new Date(startDate);
    d.setDate(startDate.getDate()+dayNumber-1);
    return d;
}

// Is this date within the 2026–2027 range chapters are allowed to start in?

function isWithinChapterDateBounds(d){
    return !!d &&
    daysDiff(CHAPTER_DATE_MIN,d)>=0 &&
    daysDiff(d,CHAPTER_DATE_MAX)>=0;
}

function clampToChapterDateBounds(d){
    if(daysDiff(CHAPTER_DATE_MIN,d)<0) return CHAPTER_DATE_MIN;
    if(daysDiff(d,CHAPTER_DATE_MAX)<0) return CHAPTER_DATE_MAX;
    return d;
}

const chapterStartDateInput=
document.getElementById("chapterStartDate");

// ADD CHAPTER POPUP

const addChapterBtn=
document.getElementById("addChapterBtn");

const chapterModal=
document.getElementById("chapterModal");

const saveChapterBtn=
document.getElementById("saveChapter");

const closePanel=
document.getElementById("closePanel");

const deleteChapterBtn =
document.getElementById("deleteChapterBtn");

closePanel.addEventListener("click",closeChapter);
document.addEventListener("click",(e)=>{
    const panel=document.getElementById("chapterPanel");
    if(panel.classList.contains("hidden")) return;
    if(panel.contains(e.target)) return;
    if(e.target.closest(".chapterBar")) return;
    if(e.target.closest(".modal")) return;
    if(e.target.closest("#chapterModal")) return;
    // Toolbar buttons that stay usable without closing the open chapter panel: Hide/Show Checkboxes, Today, Zoom −/+, Wallpaper/Neon toggles, Add Chapter
    if(e.target.closest(
        "#toggleChecksBtn, #todayBtn, #zoomOutBtn, #zoomInBtn, " +
        "#wallpaperBtn, #neonBtn, #addChapterBtn"
    )) return;
    closeChapter();
});

deleteChapterBtn.addEventListener("click",()=>{
    if(currentChapterIndex===-1) return;
    const ok=confirm(
        "Delete this chapter?\n\nThis cannot be undone."
    );
    if(!ok) return;
    chapters.splice(currentChapterIndex,1);
    localStorage.setItem(
        "chapters",
        JSON.stringify(chapters)
    );
    drawChapters();
    closeChapter();
    currentChapterIndex=-1;
});

// Open popup

addChapterBtn.addEventListener("click",()=>{
    chapterModal.classList.remove("hidden");
    if(!chapterStartDateInput.value){
        chapterStartDateInput.value=
        dateToStorageString(clampToChapterDateBounds(startDate));
    }
    syncAddingLevelsToDuration();
    validateAddChapterForm();
    updateChapterScrollArrows();
});

// Close popup

chapterModal.addEventListener("click",(e)=>{
    if(e.target===chapterModal){
        chapterModal.classList.add("hidden");
    }
});

// SAVE CHAPTER

saveChapterBtn.addEventListener("click",()=>{
    const subject=
    document.getElementById("chapterSubject").value;
    console.log("Subject =", subject);
    const name=
    document.getElementById("chapterName").value.trim();
    const selectedDate=
    storageStringToDate(chapterStartDateInput.value);
    const start=
    selectedDate ? daysBetweenInclusive(startDate,selectedDate) : NaN;
    const duration=parseInt(
        document.getElementById("chapterDuration").value
    );
    const shade=parseInt(
    document.getElementById("chapterShade").value
);
    if(!validateAddChapterForm()){
        return;
    }
    // Guarantee addingLevels exactly matches the Duration the user ended up with, even if it changed without firing the input event
    syncAddingLevelsToDuration();
    chapters.push({
        subject:subject,
        name:name,
        start:start,
        duration:duration,
        shade:shade,
        progress:new Array(duration).fill(false),
levels:addingLevels.slice()
    });
    localStorage.setItem(
        "chapters",
        JSON.stringify(chapters)
    );
    drawChapters();
    chapterModal.classList.add("hidden");
    document.getElementById("chapterName").value="";
    chapterStartDateInput.value=
    dateToStorageString(clampToChapterDateBounds(startDate));
    document.getElementById("chapterDuration").value=5;
    document.getElementById("chapterShade").value=1;
    addingLevels=new Array(5).fill("theory");
    renderAddLevelsPreview();
    validateAddChapterForm();
});

// ADD CHAPTER — LIVE LEVELS PREVIEW: level boxes always match Duration exactly; new days default to Theory, click to cycle level, same as Edit Chapter's preview

const chapterLevelsPreview=
document.getElementById("chapterLevelsPreview");

const chapterFormScroll=
document.getElementById("chapterFormScroll");

const chapterDurationInput=
document.getElementById("chapterDuration");

// Scroll arrow buttons (used by renderAddLevelsPreview whenever content height changes)

const chapterScrollUpBtn=
document.getElementById("chapterScrollUp");

const chapterScrollDownBtn=
document.getElementById("chapterScrollDown");

function updateChapterScrollArrows(){
    const atTop=
    chapterFormScroll.scrollTop<=0;
    const atBottom=
    chapterFormScroll.scrollTop+chapterFormScroll.clientHeight
    >=chapterFormScroll.scrollHeight-1;
    chapterScrollUpBtn.classList.toggle("hidden",atTop);
    chapterScrollDownBtn.classList.toggle("hidden",atBottom);
}

chapterFormScroll.addEventListener(
    "scroll",
    updateChapterScrollArrows
);

chapterScrollUpBtn.addEventListener("click",()=>{
    chapterFormScroll.scrollBy({top:-110,behavior:"smooth"});
});

chapterScrollDownBtn.addEventListener("click",()=>{
    chapterFormScroll.scrollBy({top:110,behavior:"smooth"});
});

let addingLevels=
new Array(parseInt(chapterDurationInput.value) || 0)
    .fill("theory");

function renderAddLevelsPreview(){
    chapterLevelsPreview.innerHTML="";
    addingLevels.forEach((level,index)=>{
        const box=document.createElement("div");
        box.className="levelBox "+level;
        box.title=
        level.charAt(0).toUpperCase()+level.slice(1)+
        " — click to change";
        box.addEventListener("click",()=>{
            addingLevels[index]=nextLevel(level);
            renderAddLevelsPreview();
        });
        chapterLevelsPreview.appendChild(box);
    });
    updateChapterScrollArrows();
}

// Keeps addingLevels length in sync with Duration, preserving chosen levels for days that still exist and defaulting new days to Theory

function syncAddingLevelsToDuration(){
    const duration=
    parseInt(chapterDurationInput.value) || 0;
    if(addingLevels.length<duration){
        while(addingLevels.length<duration){
            addingLevels.push("theory");
        }
    }
    else if(addingLevels.length>duration){
        addingLevels=addingLevels.slice(0,duration);
    }
    renderAddLevelsPreview();
}

chapterDurationInput.addEventListener(
    "input",
    syncAddingLevelsToDuration
);

renderAddLevelsPreview();

// ADD CHAPTER — VALIDATION: Duration must be 1+ (0-day chapters draw a stray group border with no bar); Save stays disabled until Name and Duration are valid

const chapterNameInput=
document.getElementById("chapterName");

function validateAddChapterForm(){
    const name=chapterNameInput.value.trim();
    const duration=
    parseInt(chapterDurationInput.value);
    const selectedDate=
    storageStringToDate(chapterStartDateInput.value);
    const isValid=
    name!=="" &&
    Number.isInteger(duration) &&
    duration>=1 &&
    isWithinChapterDateBounds(selectedDate);
    saveChapterBtn.disabled=!isValid;
    return isValid;
}

chapterNameInput.addEventListener("input",validateAddChapterForm);
chapterDurationInput.addEventListener("input",validateAddChapterForm);
chapterStartDateInput.addEventListener("input",validateAddChapterForm);

validateAddChapterForm();

// STUDY DAY ENGINE

// Returns true if timeline day number falls on Sunday
function isSunday(dayNumber){
    const d=new Date(startDate);
    d.setDate(startDate.getDate()+dayNumber-1);
    return d.getDay()===0;
}

// Converts study day index into timeline position; Sundays are skipped automatically

function getStudyPositions(start,duration){
    const positions=[];
    let current=start;
    while(positions.length<duration){
        if(!isSunday(current)){
            positions.push(current);
        }
        current++;
    }
    return positions;
}

// Splits study positions into groups separated by Sundays

function splitIntoSegments(days){
    const segments=[];
    let current=[];
    for(let i=0;i<days.length;i++){
        if(current.length===0){
            current.push(days[i]);
        }
        else{
            if(days[i]-days[i-1]===1){
                current.push(days[i]);
            }
            else{
                segments.push(current);
                current=[days[i]];
            }
        }
    }
    if(current.length){
        segments.push(current);
    }
    return segments;
}

// DRAW CHAPTERS

function drawChapters(){
    physicsRow.innerHTML="";
    chemistryRow.innerHTML="";
    mathsRow.innerHTML="";
    chapters.forEach((chapter,index)=>{
        // Create progress array for old chapters
        if(!chapter.progress){
            chapter.progress=new Array(chapter.duration).fill(false);
        }
        if(!chapter.levels){
    chapter.levels=new Array(chapter.duration).fill("theory");
}
        // Select subject row
        let row;
        switch(chapter.subject){
            case "physics":
                row=physicsRow;
                break;
            case "chemistry":
                row=chemistryRow;
                break;
            default:
                row=mathsRow;
        }
        // Subject colour (3 shades)
let color;
const shades={
    physics:[
        "#f87171",   // Light
        "#ef4444",   // Normal
        "#b91c1c"    // Dark
    ],
    chemistry:[
        "#4ade80",
        "#22c55e",
        "#15803d"
    ],
    maths:[
        "#60a5fa",
        "#3b82f6",
        "#1d4ed8"
    ]
};
// Brighter, more saturated versions used only while neon mode is on — swap any hex below to retune just that shade
const neonShades={
    physics:[
        "#ff7a7a",   // Light
        "#ff2e4d",   // Normal
        "#e0113f"    // Dark
    ],
    chemistry:[
        "#6bffa0",
        "#12e07c",
        "#00b359"
    ],
    maths:[
        "#6fb7ff",
        "#2f8bff",
        "#0057e7"
    ]
};
const activeShades=neonMode ? neonShades : shades;
const subjectShades=
activeShades[chapter.subject] || activeShades.maths;
color=
subjectShades[chapter.shade ?? 1];
        // Study days (Sunday skipped)
        const studyDays=getStudyPositions(
            chapter.start,
            chapter.duration
        );
        // Split chapter whenever Sunday appears
        const segments=splitIntoSegments(
            studyDays
        );
        // Group border — one outline per chapter from first to last study day (spans the Sunday gap for split chapters so both halves read as one); fixed-px border flush against the bar edges so it doesn't scale with zoom. Created before the segments below so each segment's hover listener can reach it directly
        const firstDay=studyDays[0];
        const lastDay=studyDays[studyDays.length-1];
        const groupBorder=document.createElement("div");
        groupBorder.className="chapterGroupBorder";
        groupBorder.dataset.index=index;
        groupBorder.style.left=
        (((firstDay-1)*DAY_WIDTH)-1)+"px";
        groupBorder.style.width=
        (((lastDay-firstDay+1)*DAY_WIDTH)+1)+"px";
        // Draw every segment separately
        segments.forEach(segment=>{
                        // Create one bar segment
            const zoom=document.createElement("div");
            zoom.className="chapterBar";
            // Carries this bar's colour to CSS as --barGlow: used directly as solid background in the default look, blended into a tinted fill + glow in neon mode (see NEON THEME in style.css)
            zoom.style.setProperty("--barGlow",color);
            zoom.style.left=(((segment[0]-1)*DAY_WIDTH)-1)+"px";
            zoom.style.width=(segment.length*DAY_WIDTH)+"px";
            zoom.dataset.index=index;
            zoom.addEventListener("click",()=>{
    openChapter(index);
});
            // Hovering any segment lifts the whole group border with it (same translateY as the bar's own :hover, see .chapterGroupBorder.hovered) and syncs the glow/lift to every other segment of this chapter
            zoom.addEventListener("mouseenter",()=>{
                groupBorder.classList.add("hovered");
                document.querySelectorAll('.chapterBar[data-index="'+index+'"]')
                    .forEach(bar=>bar.classList.add("hovered"));
            });
            zoom.addEventListener("mouseleave",()=>{
                groupBorder.classList.remove("hovered");
                document.querySelectorAll('.chapterBar[data-index="'+index+'"]')
                    .forEach(bar=>bar.classList.remove("hovered"));
            });
            // Hovering any segment lifts the whole group border with it (same translateY as the bar's own :hover)
            zoom.addEventListener("mouseenter",()=>{
                groupBorder.classList.add("hovered");
            });
            zoom.addEventListener("mouseleave",()=>{
                groupBorder.classList.remove("hovered");
            });
            // ---------- Title ----------
            const title=document.createElement("div");
            title.className="chapterTitle";
            title.textContent=chapter.name;
            zoom.appendChild(title);
            // ---------- Checkbox container ----------
            const checks=document.createElement("div");
            checks.className="chapterChecks";
                        // Which study day are we drawing?
            let startIndex=studyDays.indexOf(segment[0]);
            segment.forEach((day,offset)=>{
                const progressIndex=startIndex+offset;
                const box=document.createElement("input");
                box.type="checkbox";
                box.checked=chapter.progress[progressIndex] || false;
                // Without this, clicking the checkbox also triggers the bar's own click handler, opening the chapter panel — not wanted
                box.addEventListener("click",(e)=>{
                    e.stopPropagation();
                });
                box.addEventListener("change",()=>{
                    chapter.progress[progressIndex]=box.checked;
                    localStorage.setItem(
                        "chapters",
                        JSON.stringify(chapters)
                    );
                    updateMissedCounters();
                    // Keep the Chapter Details Panel's mini timeline + summary cards in sync if this chapter is currently open
                    if(
                        currentChapterIndex===index &&
                        !document.getElementById("chapterPanel")
                            .classList.contains("hidden")
                    ){
                        renderChapterMiniTimeline(currentChapterIndex);
                    }
                });
                checks.appendChild(box);
            });
            zoom.appendChild(checks);
            row.appendChild(zoom);
        });
        row.appendChild(groupBorder);
    });
        // Save upgraded chapters once
        localStorage.setItem(
        "chapters",
        JSON.stringify(chapters)
    );
    updateMissedCounters();
    // Bars were just rebuilt from scratch, so re-apply the active highlight if a chapter's panel is open
    setActiveChapterHighlight(currentChapterIndex);
}

drawChapters();

updateMissedCounters();
alignSidebar();

// ACTIVE CHAPTER HIGHLIGHT — highlights every bar segment of the chapter whose Details Panel is open (see .chapterBar.activeChapter / --activeChapterColor in style.css); pass -1 to clear

function setActiveChapterHighlight(index){
    document.querySelectorAll(".chapterBar").forEach(bar=>{
        const isActive=
        parseInt(bar.dataset.index)===index;
        bar.classList.toggle("activeChapter",isActive);
    });
    document.querySelectorAll(".chapterGroupBorder").forEach(border=>{
        const isActive=
        parseInt(border.dataset.index)===index;
        border.classList.toggle("activeChapter",isActive);
    });
}
// CURRENT PLANNER DAY

function getTodayPlannerDay(){
    const today=new Date();
    const diff=today-startDate;
    return Math.floor(
        diff/(1000*60*60*24)
    )+1;
}
// UPDATE MISSED COUNTERS

function updateMissedCounters(){
    let physicsMissed=0;
    let chemistryMissed=0;
    let mathsMissed=0;
    const today=getTodayPlannerDay();
    chapters.forEach(chapter=>{
        const studyDays=getStudyPositions(
            chapter.start,
            chapter.duration
        );
        if(!chapter.progress){
            chapter.progress=new Array(chapter.duration).fill(false);
        }
        studyDays.forEach((plannerDay,index)=>{
            if(plannerDay<today && !chapter.progress[index]){
                if(chapter.subject==="physics"){
                    physicsMissed++;
                }
                else if(chapter.subject==="chemistry"){
                    chemistryMissed++;
                }
                else{
                    mathsMissed++;
                }
            }
        });
    });
    document.getElementById("physicsMissed").textContent=physicsMissed;
    document.getElementById("chemistryMissed").textContent=chemistryMissed;
    document.getElementById("mathsMissed").textContent=mathsMissed;
}
// COMPACT MODE — auto-engages while the chapter panel is open, shrinking row/bar heights so all 3 subject rows + dates stay visible above the panel

function setCompactMode(isCompact){
    const root=document.documentElement.style;
    if(isCompact){
        const rowHeight=46;
        const rowGap=8;
        root.setProperty("--rowHeight",rowHeight+"px");
        root.setProperty("--rowGap",rowGap+"px");
        root.setProperty("--barHeight","38px");
        root.setProperty("--barTop","4px");
        root.setProperty(
            "--sundayHeight",
            (20+16+(rowGap+rowHeight)*3)+"px"
        );
        document.body.classList.add("compactMode");
    }
    else{
        const rowHeight=72;
        const rowGap=18;
        root.setProperty("--rowHeight",rowHeight+"px");
        root.setProperty("--rowGap",rowGap+"px");
        root.setProperty("--barHeight","60px");
        root.setProperty("--barTop","6px");
        root.setProperty(
            "--sundayHeight",
            (20+16+(rowGap+rowHeight)*3)+"px"
        );
        document.body.classList.remove("compactMode");
    }
    alignSidebar();
}
// OPEN CHAPTER
function openChapter(index){
    currentChapterIndex=index;
    const chapter=chapters[index];
    setCompactMode(true);
    setActiveChapterHighlight(index);
    document.getElementById("chapterPanel")
        .classList.remove("hidden");
    // Tags the panel with this chapter's subject; only visibly effective in neon mode (.subjectPhysics/.subjectChemistry/.subjectMaths in style.css) but applied in both modes so theme switches mid-session don't need a re-run
    const chapterPanelEl=document.getElementById("chapterPanel");
    chapterPanelEl.classList.remove(
        "subjectPhysics","subjectChemistry","subjectMaths"
    );
    const subjectClassMap={
        physics:"subjectPhysics",
        chemistry:"subjectChemistry",
        maths:"subjectMaths"
    };
    chapterPanelEl.classList.add(
        subjectClassMap[chapter.subject] || "subjectMaths"
    );
    document.getElementById("chapterTitle")
        .textContent=chapter.name;
    // Subject was never actually set before (hardcoded "Physics" in HTML); also show the chapter's duration beside it
    const subjectLabels={
        physics:"Physics",
        chemistry:"Chemistry",
        maths:"Maths"
    };
    document.getElementById("panelSubject")
        .textContent=
        (subjectLabels[chapter.subject] || chapter.subject)+
        " • "+chapter.duration+" days";
    // Fill in Description/Notes boxes with saved text (older chapters saved before this feature get "")
    document.getElementById("chapterDescription")
        .textContent=chapter.description || "";
    document.getElementById("chapterNotes")
        .textContent=chapter.notes || "";
        // Build Mini Timeline
renderChapterMiniTimeline(index);
}

// CHAPTER MINI TIMELINE (+ SUMMARY CARDS) — pure mirror of the planner: reads chapter.levels/progress directly, stores nothing of its own. Sundays excluded (getStudyPositions() already skips them). Call whenever levels/progress/duration change for the open chapter, instead of rebuilding the whole panel

const LEVEL_COLORS={
    theory:{
        bg:"rgba(234,179,8,0.16)",
        border:"rgba(234,179,8,0.65)"
    },
    mains:{
        bg:"rgba(0,255,247,0.16)",
        border:"rgba(0,255,247,0.65)"
    },
    advance:{
        bg:"rgba(168,85,247,0.16)",
        border:"rgba(168,85,247,0.65)"
    }
};

// CHAPTER PANEL — RESIZABLE COLUMNS: drag either mini-timeline edge to resize description/timeline/notes; one shared global width in localStorage, not saved per chapter

const chapterBodyEl=document.getElementById("chapterBody");
const colResizerLeft=document.getElementById("colResizerLeft");
const colResizerRight=document.getElementById("colResizerRight");

const CHCOL_MIN=160;     // narrowest a left/right column can get
const CHCOL_CENTER_MIN=220; // narrowest the center column can get

function loadChapterColWidths(){
    try{
        const saved=JSON.parse(
            localStorage.getItem("chapterPanelColWidths")
        );
        if(saved &&
           typeof saved.left==="number" &&
           typeof saved.right==="number"){
            return saved;
        }
    }catch(e){}
    return {left:320,right:320};
}

let chapterColWidths=loadChapterColWidths();

function applyChapterColWidths(){
    chapterBodyEl.style.setProperty(
        "--chLeftW",chapterColWidths.left+"px"
    );
    chapterBodyEl.style.setProperty(
        "--chRightW",chapterColWidths.right+"px"
    );
}

applyChapterColWidths();

function startChapterColResize(edge,startEvent){
    startEvent.preventDefault();
    const startX=startEvent.clientX;
    const startLeft=chapterColWidths.left;
    const startRight=chapterColWidths.right;
    const panelWidth=chapterBodyEl.getBoundingClientRect().width;
    document.body.classList.add("resizingCols");
    function onMove(e){
        const dx=e.clientX-startX;
        if(edge==="left"){
            const maxLeft=
            panelWidth-startRight-CHCOL_CENTER_MIN-12;
            chapterColWidths.left=
            Math.max(CHCOL_MIN,Math.min(startLeft+dx,maxLeft));
        }else{
            const maxRight=
            panelWidth-startLeft-CHCOL_CENTER_MIN-12;
            chapterColWidths.right=
            Math.max(CHCOL_MIN,Math.min(startRight-dx,maxRight));
        }
        applyChapterColWidths();
        updateMiniTimelineOverflowUI();
    }
    function onUp(){
        document.removeEventListener("mousemove",onMove);
        document.removeEventListener("mouseup",onUp);
        document.body.classList.remove("resizingCols");
        localStorage.setItem(
            "chapterPanelColWidths",
            JSON.stringify(chapterColWidths)
        );
    }
    document.addEventListener("mousemove",onMove);
    document.addEventListener("mouseup",onUp);
}

colResizerLeft.addEventListener(
    "mousedown",e=>startChapterColResize("left",e)
);

colResizerRight.addEventListener(
    "mousedown",e=>startChapterColResize("right",e)
);

window.addEventListener("resize",()=>{
    updateMiniTimelineOverflowUI();
});

// MINI TIMELINE — OVERFLOW FADE + SCROLL ARROWS: fades the edge and shows an arrow instead of clipping the last day card when the column is too narrow (max 8 cards), mirroring the Add Chapter scroll arrows sideways; a fully-visible timeline shows neither arrow

const miniTimelineEl=
document.getElementById("chapterMiniTimeline");

const miniScrollLeftBtn=
document.getElementById("miniScrollLeft");

const miniScrollRightBtn=
document.getElementById("miniScrollRight");

function updateMiniTimelineOverflowUI(){
    if(!miniTimelineEl) return;
    const hasOverflow=
    miniTimelineEl.scrollWidth>miniTimelineEl.clientWidth+1;
    if(!hasOverflow){
        miniTimelineEl.classList.remove("fadeLeft","fadeRight");
        miniScrollLeftBtn.classList.add("hidden");
        miniScrollRightBtn.classList.add("hidden");
        return;
    }
    const atStart=
    miniTimelineEl.scrollLeft<=0;
    const atEnd=
    miniTimelineEl.scrollLeft+miniTimelineEl.clientWidth
    >=miniTimelineEl.scrollWidth-1;
    miniTimelineEl.classList.toggle("fadeLeft",!atStart);
    miniTimelineEl.classList.toggle("fadeRight",!atEnd);
    miniScrollLeftBtn.classList.toggle("hidden",atStart);
    miniScrollRightBtn.classList.toggle("hidden",atEnd);
}

miniTimelineEl.addEventListener(
    "scroll",updateMiniTimelineOverflowUI
);

miniScrollLeftBtn.addEventListener("click",()=>{
    miniTimelineEl.scrollTo({left:0,behavior:"smooth"});
});

miniScrollRightBtn.addEventListener("click",()=>{
    miniTimelineEl.scrollTo({
        left:miniTimelineEl.scrollWidth,
        behavior:"smooth"
    });
});

function renderChapterMiniTimeline(index){
    const chapter=chapters[index];
    if(!chapter) return;
    const mini=document.getElementById("chapterMiniTimeline");
    mini.innerHTML="";
    const studyDays=getStudyPositions(
        chapter.start,
        chapter.duration
    );
    studyDays.forEach((dayNumber,i)=>{
        const d=new Date(startDate);
        d.setDate(startDate.getDate()+dayNumber-1);
        const level=
        (chapter.levels && chapter.levels[i]) || "theory";
        const isDone=
        (chapter.progress && chapter.progress[i]) || false;
        const card=document.createElement("div");
        card.className="miniDay";
        const colors=
        LEVEL_COLORS[level] || LEVEL_COLORS.theory;
        card.style.background=colors.bg;
        card.style.borderColor=colors.border;
        card.innerHTML=`

            <div class="miniNumber">${d.getDate()}</div>

            <div class="miniWeek">${weekdays[(d.getDay()+6)%7]}</div>

            <div class="miniCircle ${isDone?"miniCircleDone":""}">${isDone?"✓":""}</div>

        `;
        mini.appendChild(card);
    });
    updateMiniTimelineOverflowUI();
    // ---------- Summary cards (always derived, never stored) ----------
    const completed=
    (chapter.progress || []).filter(Boolean).length;
    const left=
    chapter.duration-completed;
    document.getElementById("completedCount").textContent=completed;
    document.getElementById("leftCount").textContent=left;
    // ---------- Level distribution legend (always derived) ----------
    const levels=chapter.levels || [];
    document.getElementById("theoryCount").textContent=
    levels.filter(level=>level==="theory").length;
    document.getElementById("mainsCount").textContent=
    levels.filter(level=>level==="mains").length;
    document.getElementById("advanceCount").textContent=
    levels.filter(level=>level==="advance").length;
}
// CLOSE CHAPTER

function closeChapter(){
    currentChapterIndex=-1;
    document.getElementById("chapterPanel")
        .classList.add("hidden");
    setCompactMode(false);
    setActiveChapterHighlight(-1);
}
// ZOOM CONTROLS — a click steps to the next fixed value; press-and-hold auto-repeats the step after a short delay until released, so reaching an extreme doesn't take a wall of clicks

function zoomStep(direction){
    if(direction>0){
        if(DAY_WIDTH>=84) return;
        DAY_WIDTH+=4;
    }else{
        if(DAY_WIDTH<=18) return;
        DAY_WIDTH-=4;
    }
    zoomPercent=Math.round((DAY_WIDTH/42)*100);
    zoomText.textContent=zoomPercent+"%";
    updateTimelineWidth();
    createTimeline();
    drawChapters();
    alignSidebar();
}

function setupHoldToRepeat(button,action){
    let holdTimeout=null;
    let repeatInterval=null;
    function stop(){
        clearTimeout(holdTimeout);
        clearInterval(repeatInterval);
        holdTimeout=null;
        repeatInterval=null;
    }
    function start(e){
        e.preventDefault();
        // Fires once immediately for a normal click/tap; only starts auto-repeating if still held after a short delay
        action();
        holdTimeout=setTimeout(()=>{
            repeatInterval=setInterval(action,110);
        },450);
    }
    button.addEventListener("mousedown",start);
    button.addEventListener("mouseup",stop);
    button.addEventListener("mouseleave",stop);
    button.addEventListener("touchstart",start,{passive:false});
    button.addEventListener("touchend",stop);
    button.addEventListener("touchcancel",stop);
}

setupHoldToRepeat(zoomInBtn,()=>zoomStep(1));
setupHoldToRepeat(zoomOutBtn,()=>zoomStep(-1));

// Browser zoom changes fire a resize event — re-measure/re-align whenever that happens so alignment stays correct at any zoom level

window.addEventListener("resize",alignSidebar);

// TODAY BUTTON

const todayBtn=document.getElementById("todayBtn");

const plannerArea=document.getElementById("plannerArea");

function scrollToToday(smooth){
    const todayDay=getTodayPlannerDay();
    // Pixel position of today's column inside the timeline (+20 accounts for #timeline's left padding)
    const targetX=((todayDay-1)*DAY_WIDTH)+20;
    // Position today's column toward the left of the visible area (roughly one week showing before it) instead of dead-center, so more of the width shows upcoming weeks
    const scrollX=
    targetX-(7*DAY_WIDTH);
    plannerArea.scrollTo({
        left:scrollX,
        top:0,
        behavior:smooth?"smooth":"auto"
    });
}

todayBtn.addEventListener("click",()=>{
    scrollToToday(true);
});
// HIDE / SHOW CHECKBOXES

const toggleChecksBtn=
document.getElementById("toggleChecksBtn");

let checksHidden=
localStorage.getItem("checksHidden")==="true";

function applyChecksVisibility(){
    if(checksHidden){
        document.body.classList.add("checksHidden");
        toggleChecksBtn.textContent="Show Checkboxes";
    }
    else{
        document.body.classList.remove("checksHidden");
        toggleChecksBtn.textContent="Hide Checkboxes";
    }
}

applyChecksVisibility();

toggleChecksBtn.addEventListener("click",()=>{
    checksHidden=!checksHidden;
    localStorage.setItem("checksHidden",checksHidden);
    applyChecksVisibility();
});
// DESCRIPTION / NOTES AUTO-SAVE

const chapterDescriptionBox=
document.getElementById("chapterDescription");

const chapterNotesBox=
document.getElementById("chapterNotes");

chapterDescriptionBox.addEventListener("input",()=>{
    if(currentChapterIndex===-1) return;
    chapters[currentChapterIndex].description=
    chapterDescriptionBox.textContent;
    localStorage.setItem(
        "chapters",
        JSON.stringify(chapters)
    );
});

chapterNotesBox.addEventListener("input",()=>{
    if(currentChapterIndex===-1) return;
    chapters[currentChapterIndex].notes=
    chapterNotesBox.textContent;
    localStorage.setItem(
        "chapters",
        JSON.stringify(chapters)
    );
});

// Enter inside these boxes normally creates a new <div> per line (messy HTML); instead insert a plain "\n" so saved text is plain text with real line breaks (rendered via white-space:pre-wrap)

function insertPlainLineBreak(e){
    if(e.key!=="Enter") return;
    e.preventDefault();
    const sel=window.getSelection();
    if(!sel.rangeCount) return;
    const range=sel.getRangeAt(0);
    range.deleteContents();
    const lineBreak=document.createTextNode("\n");
    range.insertNode(lineBreak);
    range.setStartAfter(lineBreak);
    range.setEndAfter(lineBreak);
    sel.removeAllRanges();
    sel.addRange(range);
    // Manually trigger save since inserting via Range doesn't fire a native "input" event
    e.target.dispatchEvent(new Event("input"));
}

chapterDescriptionBox.addEventListener(
    "keydown",
    insertPlainLineBreak
);

chapterNotesBox.addEventListener(
    "keydown",
    insertPlainLineBreak
);

// EDIT CHAPTER

const editChapterBtn=
document.getElementById("editChapterBtn");

const editModal=
document.getElementById("editModal");

const cancelEditChapter=
document.getElementById("cancelEditChapter");

const saveEditChapter=
document.getElementById("saveEditChapter");

const editChapterName=
document.getElementById("editChapterName");

const editChapterSubject=
document.getElementById("editChapterSubject");

const editChapterShade=
document.getElementById("editChapterShade");

const editChapterStartDateInput=
document.getElementById("editChapterStartDate");

const editChapterDuration=
document.getElementById("editChapterDuration");

const editTheoryDays=
document.getElementById("editTheoryDays");

const editMainsDays=
document.getElementById("editMainsDays");

const editAdvanceDays=
document.getElementById("editAdvanceDays");

const editLevelsPreview=
document.getElementById("editLevelsPreview");

let editingChapterIndex=-1;
let editingLevels=[];

// Start Date is a plain calendar input here too (see START DATE PICKER near the top for dayNumberToDate/isWithinChapterDateBounds/the 2026–2027 bounds)

// Build a levels array from Theory/Mains/Advance counts (Theory days first, then Mains, then Advance)

function buildLevelsFromCounts(theory,mains,advance){
    const levels=[];
    for(let i=0;i<theory;i++) levels.push("theory");
    for(let i=0;i<mains;i++) levels.push("mains");
    for(let i=0;i<advance;i++) levels.push("advance");
    return levels;
}

// Count how many of each level are currently in editingLevels

function countLevels(){
    let theory=0, mains=0, advance=0;
    editingLevels.forEach(level=>{
        if(level==="theory") theory++;
        else if(level==="mains") mains++;
        else if(level==="advance") advance++;
    });
    return {theory,mains,advance};
}

// Refresh the Theory/Mains/Advance number inputs to match editingLevels (used after a preview box is clicked)

function syncCountInputsFromLevels(){
    const counts=countLevels();
    editTheoryDays.value=counts.theory;
    editMainsDays.value=counts.mains;
    editAdvanceDays.value=counts.advance;
}

// Cycle a single day's level: Theory -> Mains -> Advance -> Theory

function nextLevel(level){
    if(level==="theory") return "mains";
    if(level==="mains") return "advance";
    return "theory";
}

// Draw the colored day-box preview from editingLevels; editing-only, doesn't touch the main planner timeline

function renderLevelsPreview(){
    editLevelsPreview.innerHTML="";
    editingLevels.forEach((level,index)=>{
        const box=document.createElement("div");
        box.className="levelBox "+level;
        box.title=
        level.charAt(0).toUpperCase()+level.slice(1)+
        " — click to change";
        box.addEventListener("click",()=>{
            editingLevels[index]=nextLevel(level);
            syncCountInputsFromLevels();
            renderLevelsPreview();
            validateEditForm();
        });
        editLevelsPreview.appendChild(box);
    });
}

// Rebuild editingLevels from the Theory/Mains/Advance inputs (used when the user types into one of those fields)

function rebuildLevelsFromInputs(){
    const theory=parseInt(editTheoryDays.value) || 0;
    const mains=parseInt(editMainsDays.value) || 0;
    const advance=parseInt(editAdvanceDays.value) || 0;
    editingLevels=
    buildLevelsFromCounts(theory,mains,advance);
    renderLevelsPreview();
    validateEditForm();
}

[editTheoryDays,editMainsDays,editAdvanceDays].forEach(input=>{
    input.addEventListener("input",rebuildLevelsFromInputs);
});

editChapterName.addEventListener("input",validateEditForm);
editChapterDuration.addEventListener("input",validateEditForm);

// VALIDATION

function validateEditForm(){
    const name=editChapterName.value.trim();
    const duration=parseInt(editChapterDuration.value);
    const counts=countLevels();
    const levelsSum=
    counts.theory+counts.mains+counts.advance;
    const selectedDate=
    storageStringToDate(editChapterStartDateInput.value);
    const isValid=
    name!=="" &&
    duration>=1 &&
    levelsSum===duration &&
    isWithinChapterDateBounds(selectedDate);
    saveEditChapter.disabled=!isValid;
    return isValid;
}

editChapterStartDateInput.addEventListener("input",validateEditForm);

// OPEN EDIT MODAL

function openEditModal(index){
    if(index===-1) return;
    editingChapterIndex=index;
    const chapter=chapters[index];
    editChapterName.value=chapter.name;
    editChapterSubject.value=chapter.subject;
    editChapterShade.value=chapter.shade ?? 1;
    editChapterDuration.value=chapter.duration;
    editChapterStartDateInput.value=
    dateToStorageString(dayNumberToDate(chapter.start));
    // Load existing levels — fall back to all-Theory for chapters saved before the levels feature existed, or if the stored array doesn't match the chapter's duration
    editingLevels=
    (chapter.levels && chapter.levels.length===chapter.duration)
        ? chapter.levels.slice()
        : new Array(chapter.duration).fill("theory");
    syncCountInputsFromLevels();
    renderLevelsPreview();
    validateEditForm();
    editModal.classList.remove("hidden");
}

editChapterBtn.addEventListener("click",()=>{
    openEditModal(currentChapterIndex);
});

// CLOSE EDIT MODAL (Cancel / ESC / outside click)

function closeEditModal(){
    editModal.classList.add("hidden");
    editingChapterIndex=-1;
}

cancelEditChapter.addEventListener(
    "click",
    closeEditModal
);

editModal.addEventListener("click",(e)=>{
    if(e.target===editModal){
        closeEditModal();
    }
});

document.addEventListener("keydown",(e)=>{
    if(e.key!=="Escape") return;
    if(editModal.classList.contains("hidden")) return;
    closeEditModal();
});

// SAVE EDITED CHAPTER

saveEditChapter.addEventListener("click",()=>{
    if(editingChapterIndex===-1) return;
    if(!validateEditForm()) return;
    const chapter=chapters[editingChapterIndex];
    const newDuration=
    parseInt(editChapterDuration.value);
    chapter.name=
    editChapterName.value.trim();
    chapter.subject=
    editChapterSubject.value;
    chapter.start=
    daysBetweenInclusive(
        startDate,
        storageStringToDate(editChapterStartDateInput.value)
    );
    chapter.duration=newDuration;
    chapter.shade=
    parseInt(editChapterShade.value);
    chapter.levels=editingLevels.slice();
    // Preserve progress for existing days — grow with false entries if duration increased, truncate safely if decreased
    if(!chapter.progress){
        chapter.progress=[];
    }
    if(chapter.progress.length<newDuration){
        while(chapter.progress.length<newDuration){
            chapter.progress.push(false);
        }
    }
    else if(chapter.progress.length>newDuration){
        chapter.progress=
        chapter.progress.slice(0,newDuration);
    }
    localStorage.setItem(
        "chapters",
        JSON.stringify(chapters)
    );
    drawChapters();
    // If the Chapter Details Panel is open on this chapter, refresh it so changes appear immediately
    if(currentChapterIndex===editingChapterIndex){
        openChapter(currentChapterIndex);
    }
    closeEditModal();
});

// TIMELINE RANGE PANEL — header button opening a Start/End Date panel to how much calendar the planner covers; same fade+pop/outside-click/Escape/disabled-Save behavior as the Edit Chapter modal

const dateRangeBtn=document.getElementById("dateRangeBtn");
const dateRangeModal=document.getElementById("dateRangeModal");
const rangeStartInput=document.getElementById("rangeStartDate");
const rangeEndInput=document.getElementById("rangeEndDate");
const rangeHint=document.getElementById("rangeHint");
const cancelDateRange=document.getElementById("cancelDateRange");
const saveDateRange=document.getElementById("saveDateRange");

function openDateRangeModal(){
    rangeStartInput.value=dateToStorageString(startDate);
    rangeEndInput.value=dateToStorageString(endDate);
    rangeHint.textContent=
    "Choose the first and last day of the planner.";
    saveDateRange.disabled=false;
    dateRangeModal.classList.remove("hidden");
}

function closeDateRangeModal(){
    dateRangeModal.classList.add("hidden");
}

dateRangeBtn.addEventListener("click",()=>{
    closeSettingsPanel();
    openDateRangeModal();
});

cancelDateRange.addEventListener("click",closeDateRangeModal);

dateRangeModal.addEventListener("click",(e)=>{
    if(e.target===dateRangeModal){
        closeDateRangeModal();
    }
});

document.addEventListener("keydown",(e)=>{
    if(e.key!=="Escape") return;
    if(dateRangeModal.classList.contains("hidden")) return;
    closeDateRangeModal();
});

// A day-cell (+ weekday label, date number, Sunday task box) is built for every day in range, so an unbounded span means rendering thousands of DOM elements; 1100 days (~3 years) covers any real plan while staying fast

const MAX_TIMELINE_DAYS=1100;

function validateDateRange(){
    const newStart=storageStringToDate(rangeStartInput.value);
    const newEnd=storageStringToDate(rangeEndInput.value);
    const inOrder=
    !!newStart && !!newEnd && daysDiff(newStart,newEnd)>=0;
    const withinLimit=
    inOrder &&
    daysBetweenInclusive(newStart,newEnd)<=MAX_TIMELINE_DAYS;
    const isValid=inOrder && withinLimit;
    if(!inOrder){
        rangeHint.textContent=
        "End date must be on or after the start date.";
    }
    else if(!withinLimit){
        rangeHint.textContent=
        `Range is too long — please keep it under ${MAX_TIMELINE_DAYS} days (about 3 years).`;
    }
    else{
        rangeHint.textContent=
        "Choose the first and last day of the planner.";
    }
    saveDateRange.disabled=!isValid;
    return isValid;
}

rangeStartInput.addEventListener("input",validateDateRange);
rangeEndInput.addEventListener("input",validateDateRange);

// Chapters/Sunday-tasks are stored as a day-number relative to startDate — if startDate moves, every number shifts by the same amount (the other way) so each stays pinned to the same calendar date instead of jumping

function remapDayNumbersForNewStart(oldStart,newStart){
    const shift=daysDiff(newStart,oldStart);
    if(shift===0) return;
    chapters.forEach(chapter=>{
        chapter.start=chapter.start+shift;
    });
    const remapped={};
    Object.keys(sundayTasksData).forEach(key=>{
        remapped[parseInt(key)+shift]=sundayTasksData[key];
    });
    sundayTasksData=remapped;
    localStorage.setItem("chapters",JSON.stringify(chapters));
    localStorage.setItem("sundayTasks",JSON.stringify(sundayTasksData));
}

function applyDateRange(newStart,newEnd){
    remapDayNumbersForNewStart(startDate,newStart);
    startDate=newStart;
    endDate=newEnd;
    TOTAL_DAYS=
    Math.max(1,daysBetweenInclusive(startDate,endDate));
    localStorage.setItem(
        "plannerStartDate",
        dateToStorageString(startDate)
    );
    localStorage.setItem(
        "plannerEndDate",
        dateToStorageString(endDate)
    );
    updateTimelineWidth();
    createTimeline();
    drawChapters();
    alignSidebar();
}

saveDateRange.addEventListener("click",()=>{
    if(!validateDateRange()) return;
    const newStart=storageStringToDate(rangeStartInput.value);
    const newEnd=storageStringToDate(rangeEndInput.value);
    applyDateRange(newStart,newEnd);
    closeDateRangeModal();
});

// SETTINGS PANEL — gear button opens a compact vertical panel below itself (not centered like other modals) holding Timeline Range / Export Data / Import Data, freeing header space as more actions get added

const settingsBtn=document.getElementById("settingsBtn");
const settingsPanel=document.getElementById("settingsPanel");

function openSettingsPanel(){
    settingsPanel.classList.remove("hidden");
    settingsBtn.setAttribute("aria-expanded","true");
}

function closeSettingsPanel(){
    settingsPanel.classList.add("hidden");
    settingsBtn.setAttribute("aria-expanded","false");
}

settingsBtn.addEventListener("click",(e)=>{
    e.stopPropagation();
    if(settingsPanel.classList.contains("hidden")){
        openSettingsPanel();
    }
    else{
        closeSettingsPanel();
    }
});

// Outside click closes it, same as every other popup here.

document.addEventListener("click",(e)=>{
    if(settingsPanel.classList.contains("hidden")) return;
    if(settingsPanel.contains(e.target)) return;
    if(e.target===settingsBtn) return;
    closeSettingsPanel();
});

document.addEventListener("keydown",(e)=>{
    if(e.key!=="Escape") return;
    if(settingsPanel.classList.contains("hidden")) return;
    closeSettingsPanel();
});

// EXPORT / IMPORT (BACKUP & RESTORE) — everything lives only in this browser's localStorage; these buttons turn it into a plain .json file to save/load elsewhere. Every localStorage key the app uses anywhere is listed here once, so a new key is a one-line addition

const BACKUP_KEYS=[
    "chapters",
    "sundayTasks",
    "plannerStartDate",
    "plannerEndDate",
    "wallpaperHidden",
    "neonMode",
    "checksHidden",
    "chapterPanelColWidths"
];

const BACKUP_FORMAT_VERSION=1;

const exportBtn=document.getElementById("exportBtn");
const exportModal=document.getElementById("exportModal");
const cancelExport=document.getElementById("cancelExport");
const confirmExport=document.getElementById("confirmExport");

const importBtn=document.getElementById("importBtn");
const importFileInput=document.getElementById("importFileInput");
const importModal=document.getElementById("importModal");
const importHint=document.getElementById("importHint");
const cancelImport=document.getElementById("cancelImport");
const confirmImport=document.getElementById("confirmImport");

// Holds the parsed backup object between "file picked" and "user confirmed the overwrite" — nothing is written to localStorage until confirmImport runs
let pendingImportData=null;

// ---------------- EXPORT ----------------

function openExportModal(){
    exportModal.classList.remove("hidden");
}

function closeExportModal(){
    exportModal.classList.add("hidden");
}

function downloadBackupFile(){
    const backup={
        formatVersion:BACKUP_FORMAT_VERSION,
        exportedAt:new Date().toISOString(),
        data:{}
    };
    BACKUP_KEYS.forEach(key=>{
        const value=localStorage.getItem(key);
        if(value!==null){
            backup.data[key]=value;
        }
    });
    const json=JSON.stringify(backup,null,2);
    const blob=new Blob([json],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    const stamp=dateToStorageString(new Date());
    link.href=url;
    link.download=`study-planner-backup-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

exportBtn.addEventListener("click",()=>{
    closeSettingsPanel();
    openExportModal();
});

cancelExport.addEventListener("click",closeExportModal);

confirmExport.addEventListener("click",()=>{
    downloadBackupFile();
    closeExportModal();
});

exportModal.addEventListener("click",(e)=>{
    if(e.target===exportModal){
        closeExportModal();
    }
});

// ---------------- IMPORT ----------------

// Clicking Import opens the OS file picker directly (no modal yet); once a file parses as a valid backup, the confirmation modal appears before anything touches localStorage

importBtn.addEventListener("click",()=>{
    closeSettingsPanel();
    importFileInput.value="";
    importFileInput.click();
});

function openImportModal(fileName){
    importHint.textContent=
    `Importing "${fileName}" will overwrite your current chapters, checkboxes data, and settings. This cannot be undone.`;
    confirmImport.disabled=false;
    importModal.classList.remove("hidden");
}

function closeImportModal(){
    importModal.classList.add("hidden");
    pendingImportData=null;
}

importFileInput.addEventListener("change",()=>{
    const file=importFileInput.files[0];
    if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>{
        let parsed;
        try{
            parsed=JSON.parse(reader.result);
        }
        catch(err){
            alert("That file isn't a valid backup (couldn't read it as JSON).");
            return;
        }
        // Accepts either the wrapped {formatVersion, data} shape this app writes, or a bare {key:value} object, so an older/hand-edited backup still loads
        const data=
        (parsed && typeof parsed==="object" && parsed.data)
        ? parsed.data
        : parsed;
        const looksValid=
        data && typeof data==="object" &&
        BACKUP_KEYS.some(key=>key in data);
        if(!looksValid){
            alert("That file doesn't look like a Study Planner backup.");
            return;
        }
        pendingImportData=data;
        openImportModal(file.name);
    };
    reader.onerror=()=>{
        alert("Couldn't read that file. Please try again.");
    };
    reader.readAsText(file);
});

cancelImport.addEventListener("click",closeImportModal);

importModal.addEventListener("click",(e)=>{
    if(e.target===importModal){
        closeImportModal();
    }
});

confirmImport.addEventListener("click",()=>{
    if(!pendingImportData) return;
    BACKUP_KEYS.forEach(key=>{
        if(key in pendingImportData){
            localStorage.setItem(key,pendingImportData[key]);
        }
    });
    closeImportModal();
    // Reloading is the simplest reliable way to make every part of the app (grid, sidebar, theme, zoom, chapter panel) reflect the restored data, instead of risking a missed variable by patching in-memory state by hand
    location.reload();
});

document.addEventListener("keydown",(e)=>{
    if(e.key!=="Escape") return;
    if(!exportModal.classList.contains("hidden")){
        closeExportModal();
    }
    if(!importModal.classList.contains("hidden")){
        closeImportModal();
    }
    if(!resetModal.classList.contains("hidden")){
        closeResetModal();
    }
});

// RESET DATA — wipes everything in localStorage (chapters, checkboxes, settings) and starts fresh. Destructive, so the confirm button must be pressed and held for 1.5s (a darker fill sweeps left-to-right as a visual timer); releasing early cancels

const resetBtn=document.getElementById("resetBtn");
const resetModal=document.getElementById("resetModal");
const cancelReset=document.getElementById("cancelReset");
const confirmReset=document.getElementById("confirmReset");
const resetHoldFill=document.getElementById("resetHoldFill");

const RESET_HOLD_MS=1500;

let holdActive=false;

function openResetModal(){
    resetHoldFill.style.transition="none";
    resetHoldFill.style.width="0%";
    resetModal.classList.remove("hidden");
}

function closeResetModal(){
    cancelHold();
    resetModal.classList.add("hidden");
}

resetBtn.addEventListener("click",()=>{
    closeSettingsPanel();
    openResetModal();
});

cancelReset.addEventListener("click",closeResetModal);

resetModal.addEventListener("click",(e)=>{
    if(e.target===resetModal){
        closeResetModal();
    }
});

function performReset(){
    localStorage.clear();
    location.reload();
}

function startHold(){
    holdActive=true;
    resetHoldFill.style.transition=`width ${RESET_HOLD_MS}ms linear`;
    // Two rAFs so the browser paints the 0%-width state from openResetModal() first — otherwise it can collapse the reset and the new transition into one jump, skipping the fill animation
    requestAnimationFrame(()=>{
        requestAnimationFrame(()=>{
            if(!holdActive) return;
            resetHoldFill.style.width="100%";
        });
    });
}

function cancelHold(){
    if(!holdActive) return;
    holdActive=false;
    resetHoldFill.style.transition="width .15s ease";
    resetHoldFill.style.width="0%";
}

resetHoldFill.addEventListener("transitionend",(e)=>{
    if(e.propertyName!=="width") return;
    if(!holdActive) return;
    // Only the full 1.5s fill (not the quick .15s snap-back on release) should trigger the delete
    if(resetHoldFill.style.width!=="100%") return;
    holdActive=false;
    performReset();
});

confirmReset.addEventListener("pointerdown",startHold);
confirmReset.addEventListener("pointerup",cancelHold);
confirmReset.addEventListener("pointerleave",cancelHold);
confirmReset.addEventListener("pointercancel",cancelHold);

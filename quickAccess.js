// quickAccess.js
// Standalone file for the floating "Todolist" button + its panel.
// Nothing here touches script.js/pomodoro.js and nothing there
// should touch this. Panel content is a placeholder for now — to
// be filled in later.

const quickAccessBtn=document.getElementById("quickAccessBtn");
const todoPanel=document.getElementById("todoPanel");
const todoPanelCloseBtn=document.getElementById("todoPanelCloseBtn");
const todoPanelDate=document.getElementById("todoPanelDate");
const todoDayTypeLabel=document.getElementById("todoDayTypeLabel");
const todoPrevDayBtn=document.getElementById("todoPrevDayBtn");
const todoNextDayBtn=document.getElementById("todoNextDayBtn");
const todoModeToggleBtn=document.getElementById("todoModeToggleBtn");
const todoModeToggleLabel=document.getElementById("todoModeToggleLabel");
const todoList=document.getElementById("todoList");
const addTodoBtn=document.getElementById("addTodoBtn");

// ================= HEADER TARGET ICON =================
// Markup/positioning lives in index.html (first item inside
// .headerButtons, left of "+ Add Chapter"); all styling is in
// quickAccess.css and all behavior is wired up here. Click action
// to be added later.

const quickTargetBtn=document.getElementById("quickTargetBtn");
const targetPanel=document.getElementById("targetPanel");
const targetPanelExpandBtn=document.getElementById("targetPanelExpandBtn");
const targetPanelShrinkBtn=document.getElementById("targetPanelShrinkBtn");
const targetPanelEditBtn=document.getElementById("targetPanelEditBtn");
const targetView=document.getElementById("targetView");
const targetTitleDisplay=document.getElementById("targetTitleDisplay");
const targetDetailsDisplay=document.getElementById("targetDetailsDisplay");
const targetEdit=document.getElementById("targetEdit");
const targetTitleInput=document.getElementById("targetTitleInput");
const targetDetailsInput=document.getElementById("targetDetailsInput");
const topHeader=document.getElementById("topHeader");

// Anchors the panel to the very top of the page — so it sits on
// the header itself rather than below it — horizontally positioned
// so its right edge sits just left of #quickTargetBtn, reading as
// "belonging" to that button rather than being centered under it.
// Clamped so it never runs off the left edge of the viewport.
// Recomputed every time the panel opens (and on resize while it's
// open) so it stays put across window sizes.
function positionTargetPanel(){
    const btnRect=quickTargetBtn.getBoundingClientRect();
    const panelWidth=targetPanel.offsetWidth;
    const margin=12;
    const gap=10;

    let left=btnRect.left-gap-panelWidth;
    left=Math.max(margin,left);

    targetPanel.style.left=left+"px";
    targetPanel.style.top="0px";
}

// Toggled ONLY by re-clicking quickTargetBtn — no outside-click,
// no Escape key, no close (×) button. Content is a placeholder for
// now and gets filled in later.
quickTargetBtn.addEventListener("click",()=>{
    const wasOpen=targetPanel.classList.contains("open");
    positionTargetPanel();
    targetPanel.classList.toggle("open");
    // Closing the panel mid-edit should save rather than silently
    // discard whatever was typed.
    if(wasOpen && targetPanel.classList.contains("editingTarget")){
        saveTargetEdit();
    }
    // Always land back in shrunk (heading-only) mode on close, so
    // the next open starts collapsed regardless of how it was left.
    if(wasOpen){
        targetPanel.classList.remove("expanded");
    }
});

window.addEventListener("resize",()=>{
    if(targetPanel.classList.contains("open")) positionTargetPanel();
});

targetPanelExpandBtn.addEventListener("click",()=>{
    targetPanel.classList.add("expanded");
});

targetPanelShrinkBtn.addEventListener("click",()=>{
    // Edit fields only render while expanded — shrinking away from
    // them should save whatever was typed, not discard it.
    if(targetPanel.classList.contains("editingTarget")) saveTargetEdit();
    targetPanel.classList.remove("expanded");
});

// ================= TARGET (ongoing) — notice-board content =================
// A single persistent heading + details shown inside the target panel.
// Collapsed: just the (truncated) heading. Expanded: full heading +
// details, plus the bottom-left edit button to change them.

const TARGET_DATA_KEY="targetData"; // { title, details }

function loadTargetData(){
    try{
        const raw=localStorage.getItem(TARGET_DATA_KEY);
        return raw ? JSON.parse(raw) : {title:"",details:""};
    }catch(e){
        return {title:"",details:""};
    }
}

function saveTargetData(data){
    try{
        localStorage.setItem(TARGET_DATA_KEY,JSON.stringify(data));
    }catch(e){ /* storage unavailable — fail silently */ }
}

function renderTargetView(){
    const data=loadTargetData();
    targetTitleDisplay.textContent=data.title.trim()===""
        ? "No target set yet"
        : data.title;
    targetDetailsDisplay.textContent=data.details;
}

function enterTargetEdit(){
    const data=loadTargetData();
    targetTitleInput.value=data.title;
    targetDetailsInput.value=data.details;
    targetPanel.classList.add("editingTarget");
    targetTitleInput.focus();
}

function saveTargetEdit(){
    saveTargetData({
        title:targetTitleInput.value,
        details:targetDetailsInput.value
    });
    targetPanel.classList.remove("editingTarget");
    renderTargetView();
}

targetPanelEditBtn.addEventListener("click",()=>{
    if(targetPanel.classList.contains("editingTarget")){
        saveTargetEdit();
    }else{
        enterTargetEdit();
    }
});

renderTargetView();

function openTodoPanel(){
    purgeOldDays();
    todoPanel.classList.remove("hidden");
    quickAccessBtn.classList.add("qaActive");
    document.body.classList.add("todoOpen");
    renderTodoDay();
}

function closeTodoPanel(){
    todoPanel.classList.add("hidden");
    quickAccessBtn.classList.remove("qaActive");
    document.body.classList.remove("todoOpen");
}

quickAccessBtn.addEventListener("click",()=>{
    if(todoPanel.classList.contains("hidden")){
        openTodoPanel();
    }else{
        closeTodoPanel();
    }
});

todoPanelCloseBtn.addEventListener("click",()=>{
    closeTodoPanel();
});

// ================= TODO LIST — per-day data, 10-day window =================
// 3 past days (view only), today (editable + checkable), next 6 days
// (add/edit tasks, checkboxes locked). Data is saved per calendar day
// in localStorage. Once a day falls behind the 3-past-day window its
// task text is purged, but a {done,total} score is kept forever for
// a future analysis panel.

const TODO_DATA_KEY="todoData";       // { "YYYY-MM-DD": { tasks:[{id,text,done}] } }
const TODO_SCORES_KEY="todoScores";   // { "YYYY-MM-DD": { done, total } }
const TODO_PAST_LIMIT=3;
const TODO_FUTURE_LIMIT=6;

let todoMode="edit"; // "edit" | "read" — only meaningful for today/future
let todoIdCounter=0;
let currentViewDate=startOfDay(new Date());

function startOfDay(d){
    const c=new Date(d);
    c.setHours(0,0,0,0);
    return c;
}

function addDays(d,n){
    const c=new Date(d);
    c.setDate(c.getDate()+n);
    return c;
}

function dateKey(d){
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,"0");
    const day=String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
}

function loadJSON(key){
    try{
        const raw=localStorage.getItem(key);
        return raw ? JSON.parse(raw) : {};
    }catch(e){
        return {};
    }
}

function saveJSON(key,obj){
    try{
        localStorage.setItem(key,JSON.stringify(obj));
    }catch(e){ /* storage unavailable — fail silently */ }
}

function getDayType(viewDate,today){
    if(viewDate.getTime()<today.getTime()) return "past";
    if(viewDate.getTime()>today.getTime()) return "future";
    return "today";
}

// Any stored day older than (today - TODO_PAST_LIMIT) gets its task
// text deleted, keeping only a done/total score.
function purgeOldDays(){
    const today=startOfDay(new Date());
    const cutoff=addDays(today,-TODO_PAST_LIMIT);
    const data=loadJSON(TODO_DATA_KEY);
    const scores=loadJSON(TODO_SCORES_KEY);
    let changed=false;

    Object.keys(data).forEach(key=>{
        const [y,m,d]=key.split("-").map(Number);
        const keyDate=new Date(y,m-1,d);
        if(keyDate.getTime()<cutoff.getTime()){
            const tasks=(data[key] && data[key].tasks) || [];
            scores[key]={
                done:tasks.filter(t=>t.done).length,
                total:tasks.length
            };
            delete data[key];
            changed=true;
        }
    });

    if(changed){
        saveJSON(TODO_DATA_KEY,data);
        saveJSON(TODO_SCORES_KEY,scores);
    }
}

function getTasksForDate(viewDate,dayType){
    const data=loadJSON(TODO_DATA_KEY);
    const key=dateKey(viewDate);
    if(data[key] && Array.isArray(data[key].tasks)){
        return data[key].tasks;
    }
    // No saved data yet: past days with nothing saved simply have
    // no tasks; today/future days start with 3 blank lines to fill in.
    return dayType==="past" ? [] : [
        {id:todoIdCounter++,text:"",done:false},
        {id:todoIdCounter++,text:"",done:false},
        {id:todoIdCounter++,text:"",done:false}
    ];
}

function saveTasksForDate(viewDate,tasks){
    const data=loadJSON(TODO_DATA_KEY);
    data[dateKey(viewDate)]={tasks};
    saveJSON(TODO_DATA_KEY,data);
}

let todoTasks=[];
let todoDayType="today";

function formatDateLabel(d){
    const opts={weekday:"long",day:"numeric",month:"long"};
    return d.toLocaleDateString(undefined,opts);
}

function renderTodoDay(){
    const today=startOfDay(new Date());
    todoDayType=getDayType(currentViewDate,today);
    todoTasks=getTasksForDate(currentViewDate,todoDayType);

    todoPanel.classList.remove("pastDay","todayDay","futureDay");
    todoPanel.classList.add(todoDayType+"Day");

    todoPanelDate.textContent=formatDateLabel(currentViewDate);
    todoDayTypeLabel.textContent=
        todoDayType==="today" ? "Today" :
        todoDayType==="past" ? "Past · view only" :
        "Upcoming · can't check off yet";

    const minDate=addDays(today,-TODO_PAST_LIMIT);
    const maxDate=addDays(today,TODO_FUTURE_LIMIT);
    todoPrevDayBtn.disabled=(dateKey(currentViewDate)===dateKey(minDate));
    todoNextDayBtn.disabled=(dateKey(currentViewDate)===dateKey(maxDate));

    setTodoMode(todoMode==="edit" && todoDayType!=="past" ? "edit" : "read",false);
}

function setTodoMode(mode,rerender){
    if(rerender===undefined) rerender=true;
    todoMode=mode;
    todoPanel.classList.toggle("editMode",todoMode==="edit" && todoDayType!=="past");
    todoModeToggleLabel.textContent=todoMode==="edit" ? "Read" : "Edit";
    if(rerender) renderTodoList();
    else renderTodoList();
}

function persistCurrentDay(){
    if(todoDayType==="past") return; // never write to locked past days
    saveTasksForDate(currentViewDate,todoTasks);
}

function toggleTodoDone(id){
    if(!(todoDayType==="today" && todoMode==="read")) return;
    const task=todoTasks.find(t=>t.id===id);
    if(!task) return;
    task.done=!task.done;
    persistCurrentDay();
    renderTodoList();
}

function updateTodoText(id,value){
    const task=todoTasks.find(t=>t.id===id);
    if(!task) return;
    task.text=value;
    persistCurrentDay();
}

function deleteTodoTask(id){
    if(todoDayType==="past") return;
    todoTasks=todoTasks.filter(t=>t.id!==id);
    persistCurrentDay();
    renderTodoList();
}

function addTodoTask(focus){
    if(todoDayType==="past") return;
    const newTask={id:todoIdCounter++,text:"",done:false};
    todoTasks.push(newTask);
    persistCurrentDay();
    renderTodoList();
    if(focus){
        const input=todoList.querySelector(`[data-task-id="${newTask.id}"] .todoItemInput`);
        if(input) input.focus();
    }
}

function isEditable(){
    return todoDayType!=="past" && todoMode==="edit";
}

function renderTodoList(){
    todoList.innerHTML="";

    if(todoTasks.length===0){
        const empty=document.createElement("li");
        empty.className="todoEmptyState";
        empty.textContent=todoDayType==="past"
            ? "No tasks recorded for this day."
            : "No tasks yet.";
        todoList.appendChild(empty);
        return;
    }

    todoTasks.forEach(task=>{
        const li=document.createElement("li");
        li.className="todoItem"+(task.done ? " completed" : "");
        li.dataset.taskId=task.id;

        const checkBtn=document.createElement("button");
        checkBtn.type="button";
        checkBtn.className="todoCheckBtn";
        checkBtn.setAttribute("aria-label","Toggle task complete");
        checkBtn.innerHTML=`<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 12.5l5 5L20 6" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
        checkBtn.addEventListener("click",()=>toggleTodoDone(task.id));
        li.appendChild(checkBtn);

        if(isEditable()){
            const input=document.createElement("input");
            input.type="text";
            input.className="todoItemInput";
            input.placeholder="Task…";
            input.value=task.text;
            input.addEventListener("input",(e)=>updateTodoText(task.id,e.target.value));
            li.appendChild(input);
        }else{
            const span=document.createElement("span");
            span.className="todoItemText";
            span.textContent=task.text.trim()==="" ? "(empty task)" : task.text;
            li.appendChild(span);
        }

        const deleteBtn=document.createElement("button");
        deleteBtn.type="button";
        deleteBtn.className="todoDeleteBtn";
        deleteBtn.setAttribute("aria-label","Delete task");
        deleteBtn.innerHTML=`<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
        </svg>`;
        deleteBtn.addEventListener("click",()=>deleteTodoTask(task.id));
        li.appendChild(deleteBtn);

        todoList.appendChild(li);
    });
}

todoModeToggleBtn.addEventListener("click",()=>{
    if(todoDayType==="past") return;
    setTodoMode(todoMode==="edit" ? "read" : "edit");
});

addTodoBtn.addEventListener("click",()=>{
    addTodoTask(true);
});

todoPrevDayBtn.addEventListener("click",()=>{
    const today=startOfDay(new Date());
    const minDate=addDays(today,-TODO_PAST_LIMIT);
    const next=addDays(currentViewDate,-1);
    if(next.getTime()>=minDate.getTime()){
        currentViewDate=next;
        renderTodoDay();
    }
});

todoNextDayBtn.addEventListener("click",()=>{
    const today=startOfDay(new Date());
    const maxDate=addDays(today,TODO_FUTURE_LIMIT);
    const next=addDays(currentViewDate,1);
    if(next.getTime()<=maxDate.getTime()){
        currentViewDate=next;
        renderTodoDay();
    }
});

purgeOldDays();
renderTodoDay();

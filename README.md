# Captain's Backlog

A personal daily task planner with a kanban board. No frameworks, no build tools, no accounts — just open the HTML file in your browser and start planning.

## How to Use

Open `captains-backlog.html` directly in Chrome or Edge (works with `file://` protocol).

### Daily Workflow

1. **Backlog** — Add new tasks here as they come up during your day. Use the auto-sort settings to keep the most relevant tasks at the top.
2. **Today** — Each morning, drag tasks from the Backlog into the Today column. The effort sum in the column header helps you pick the right amount of work for the day.
3. **In Progress** — When you start working on a task, drag it here. Keep an eye on your WIP count to stay focused.
4. **Done** — Drag completed tasks here. The column automatically shows only the last 30 days and lets you expand older items if needed.

## Features

### Task Management

- **Add, edit, and delete tasks** via modals. Click a card to view its details, or use the edit/delete buttons that appear on hover.
- **Drag and drop** tasks between columns and reorder within columns (except Backlog, which is auto-sorted).
- Each task can have a **title**, **description**, **priority** (None / Low / Medium / High / Critical), **effort** estimate (None / 0.5 / 1 / 2 / 4 / 8), **due date**, and **tags**.

### Priority and Due Dates

- Cards are color-coded by priority on the left border.
- Due date badges show contextual labels: **Today**, **Tomorrow**, **This week**, **Next week**, or the exact date. Overdue tasks are highlighted in red. Hover over a badge to see the full date (DD/MM/YYYY).

### Effort Tracking

- The **Today** column header displays the total effort of all tasks in the column, helping you plan a realistic workload.

### Backlog Auto-Sort

- Click **Sort** to configure multi-level sort rules for the Backlog column.
- Available sort fields: Due Date, Priority, Effort, Date Created, Title.
- Each rule can be ascending or descending. Tasks are sorted by the first rule, then ties are broken by subsequent rules.
- Other columns (Today, In Progress, Done) use manual drag ordering.

### Tags

- Add comma-separated tags to any task (e.g. `bug, frontend, api`).
- **Auto-complete**: When typing tags in the add/edit modal, a dropdown suggests existing tags from across all your tasks. Navigate with arrow keys and select with Enter or click.
- **Filter by tag**: Click any tag on a card to filter that column to show only tasks with that tag. Active filters appear as badges below the column header. Remove filters individually or click "Clear all".

### Done Column

- Only the last 30 days of completed tasks are shown by default.
- A "Show X older" button lets you expand the full history when needed.

### Data Persistence

- **Auto-save to localStorage**: Every change is saved instantly. Close the tab, reopen the page, and your data is right where you left it.
- **Optional JSON file sync**: Click "Save As" to link a `.json` file on your computer. Once linked, changes auto-sync to the file silently (debounced 500ms). The file handle is remembered across browser sessions via IndexedDB, so you only need to link once.
- **Open**: Load data from an existing `.json` file.
- **Ctrl+S**: Force an immediate save to the linked file at any time.

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `Ctrl+S` | Save to linked file |
| `Enter` | Submit the add/edit modal |
| `Escape` | Close any open modal or panel |

## Files

```
captains-backlog.html  — Entry point, open this in your browser
app.js                 — Application logic
styles.css             — Styles (dark theme)
```

## Browser Support

Requires a modern Chromium-based browser (Chrome, Edge, Brave, etc.) for full functionality. The File System Access API used for silent file saves is not supported in Firefox or Safari — in those browsers, saving falls back to downloading a JSON file.

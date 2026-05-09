const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(process.cwd(), 'history.db');
const REPORT_FILE = path.join(process.cwd(), 'structure-report.json');

let db;
let SQL;

// =======================
// Initialize DB
// =======================
async function initDB() {

  if (db) return db;

  SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {

    const fileBuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(fileBuffer);

  } else {

    db = new SQL.Database();

    db.run(`
      CREATE TABLE IF NOT EXISTS responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apiPath TEXT,
        method TEXT,
        normalizedPath TEXT,
        signature TEXT,
        response TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

  }

  return db;

}

// =======================
// Load all responses
// =======================
async function getAllResponses() {

  const db = await initDB();

  const res =
    db.exec(
      `SELECT * FROM responses ORDER BY apiPath, createdAt ASC;`
    );

  if (!res.length) return [];

  const rows = [];

  const values = res[0].values;
  const columns = res[0].columns;

  values.forEach(r => {

    const obj = {};

    r.forEach(
      (v, idx) =>
        (obj[columns[idx]] = v)
    );

    rows.push(obj);

  });

  return rows;

}

// =======================
// Extract structure
// =======================
function extractStructure(obj) {

  if (Array.isArray(obj)) {

    if (!obj.length)
      return 'array';

    return [
      extractStructure(obj[0])
    ];

  }

  else if (
    obj &&
    typeof obj === 'object'
  ) {

    const struct = {};

    for (const key of Object.keys(obj)) {

      struct[key] =
        extractStructure(obj[key]);

    }

    return struct;

  }

  else {

    return typeof obj;

  }

}

// =======================
// Compare structures
// =======================
function compareStructures(
  oldStruct,
  newStruct,
  path = ''
) {

  const diffs = [];

  if (
    typeof oldStruct !==
    typeof newStruct
  ) {

    diffs.push({
      path,
      oldType: typeof oldStruct,
      newType: typeof newStruct
    });

    return diffs;

  }

  if (
    Array.isArray(oldStruct) &&
    Array.isArray(newStruct)
  ) {

    if (
      oldStruct.length === 0 ||
      newStruct.length === 0
    )
      return diffs;

    diffs.push(
      ...compareStructures(
        oldStruct[0],
        newStruct[0],
        path + '[0]'
      )
    );

  }

  else if (
    typeof oldStruct === 'object' &&
    typeof newStruct === 'object'
  ) {

    const allKeys =
      new Set([
        ...Object.keys(oldStruct),
        ...Object.keys(newStruct)
      ]);

    for (const key of allKeys) {

      if (!(key in oldStruct)) {

        diffs.push({
          path: path + '.' + key,
          oldType: 'missing',
          newType: typeof newStruct[key]
        });

      }

      else if (!(key in newStruct)) {

        diffs.push({
          path: path + '.' + key,
          oldType: typeof oldStruct[key],
          newType: 'missing'
        });

      }

      else {

        diffs.push(
          ...compareStructures(
            oldStruct[key],
            newStruct[key],
            path
              ? path + '.' + key
              : key
          )
        );

      }

    }

  }

  return diffs;

}

// =======================
// Main: show DB + file report
// =======================
async function showDB(detailsPath = null) {

  const rows =
    await getAllResponses();

  if (!rows.length) {

    console.log(
      '⚠ جدول responses خالی است.'
    );

    return;

  }

  // =======================
  // Group by endpoint
  // =======================
  const grouped = {};

  rows.forEach(r => {

    const key =
      `${r.method} ${r.normalizedPath}`;

    if (!grouped[key])
      grouped[key] = [];

    grouped[key].push(r);

  });

  // =======================
  // Convert to sortable array
  // =======================
  const endpoints =
    Object.keys(grouped).map(endpoint => {

      const executions =
        grouped[endpoint];

      const lastExecution =
        executions[
          executions.length - 1
        ];

      return {

        endpoint,

        executions,

        lastDate:
          lastExecution.createdAt,

        lastId:
          lastExecution.id

      };

    });

  // =======================
  // Sort by latest execution date DESC
  // =======================
  endpoints.sort(
    (a, b) =>
      new Date(b.lastDate)
      - new Date(a.lastDate)
  );

  console.log(
    '\n========= STRUCTURE REPORT =========\n'
  );

  const structureReport = [];

  // =======================
  // Main loop
  // =======================
  for (const item of endpoints) {

    const endpoint =
      item.endpoint;

    const executions =
      item.executions.slice(-5);

    const latest =
      executions[
        executions.length - 1
      ];

    const latestResp =
      JSON.parse(latest.response);

    const latestStruct =
      extractStructure(latestResp);

    let changesDetected = false;

    let allDiffs = [];

    for (
      let i = 0;i < executions.length - 1;i++
    ) {

      const oldResp =
        JSON.parse(
          executions[i].response
        );

      const oldStruct =
        extractStructure(oldResp);

      const diffs =
        compareStructures(
          oldStruct,
          latestStruct
        );

      if (diffs.length) {

        changesDetected = true;

        allDiffs.push(...diffs);

      }

    }

    // =======================
    // Console output
    // =======================
    console.log(
      changesDetected
        ? '⚠ STRUCTURE CHANGES DETECTED'
        : '✔ No structural changes'
    );

    console.log(
      `Endpoint: ${endpoint}`
    );

    console.log(
      `Last Execution: ID ${latest.id} | ${latest.createdAt}`
    );

    console.log(
      `Last 5 executions: ${
        executions.map(
          e =>
            `${e.id} (${e.createdAt})`
        ).join(', ')
      }`
    );

    if (changesDetected) {

      console.log(
        'Changes detected:'
      );

      allDiffs.forEach(d => {

        console.log(
          `  • ${d.path}: ${d.oldType} → ${d.newType}`
        );

      });

    }

    if (
      detailsPath &&
      endpoint === detailsPath
    ) {

      console.log(
        'Latest structure:'
      );

      console.log(
        JSON.stringify(
          latestStruct,
          null,
          2
        )
      );

    }

    console.log(
      '-----------------------------------\n'
    );

    // =======================
    // File report
    // =======================
    structureReport.push({

      endpoint,

      lastExecutionId:
        latest.id,

      lastExecutionDate:
        latest.createdAt,

      lastCheckedExecutions:
        executions.map(e => ({
          id: e.id,
          date: e.createdAt
        })),

      hasChanges:
        changesDetected,

      changes:
        changesDetected
          ? allDiffs.map(
              d =>
                `${d.path}: ${d.oldType} → ${d.newType}`
            )
          : []

    });

  }

  // =======================
  // Save report file
  // =======================
  fs.writeFileSync(

    REPORT_FILE,

    JSON.stringify(
      structureReport,
      null,
      2
    ),

    'utf-8'

  );

  console.log(
    `📄 Structure report saved to ${REPORT_FILE}`
  );

}

// =======================
// CLI
// =======================
const args =
  process.argv.slice(2);

let detailsPath = null;

if (
  args[0] === '--details'
  && args[1]
) {

  detailsPath = args[1];

}

showDB(detailsPath);

// =======================
// usage:
// node showDB.js
// node showDB.js --details "GET /api/core/content-types/my"

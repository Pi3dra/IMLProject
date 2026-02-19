import '@marcellejs/core/dist/marcelle.css';
import {
  dataset,
  dataStore,
  dashboard,
  datasetTable,
  datasetBrowser
} from '@marcellejs/core';

const dash = dashboard({ title: 'My Marcelle App', author: 'You' });

// Connect to the Marcelle backend (for dataset storage)
const store = dataStore('http://localhost:3030');
const trainingSet = dataset('TrainingSet', store);

// Debug logs
trainingSet.$count.subscribe(count => {
  console.log(`Dataset contains ${count} instances`);
});

trainingSet.$changes.subscribe(changes => {
  console.log('Dataset changes:', changes);
});


// ==================== LOADING DATASET ==================== 


const staticBase = 'http://localhost:8000';

async function importAllFromServer() {
  await new Promise(r => setTimeout(r, 1000)); // give backend time

  try {
    const resp = await fetch(`${staticBase}/index.json`);
    if (!resp.ok) throw new Error("index.json not found");
    const allInstances = await resp.json();
    console.log(`Found ${allInstances.length} images in index`);

    // Optional: skip if already many items exist
    const currentCount = await trainingSet.$count.get();
    if (currentCount >= allInstances.length) {
      console.log("Dataset already seems populated — skipping");
      return;
    }

    // Bulk create — Marcelle supports receiving an array in some stores, but safest is loop
    let added = 0;
    for (const inst of allInstances) {
      inst.x = new URL(inst.x, staticBase).href;
      inst.thumbnail = new URL(inst.thumbnail, staticBase).href;
      
      try {
        await trainingSet.create(inst);
        added++;
      } catch (e) {
        console.warn("Skip duplicate / failed:", inst.x, e);
      }
    }
    console.log(`Imported ${added} new instances`);
  } catch (err) {
    console.error("Import failed:", err);
  }
}

// Run once — same pattern as your addTestInstances
importAllFromServer();


// ==================== DISPLAY DATASET ==================== 

// Display components
const browser = datasetBrowser(trainingSet); // grid of thumbnails + labels

const table = datasetTable(trainingSet, ['thumbnail', 'y']);
dash.page('Data Management')
  .use(browser)   // main visual display

dash.show();

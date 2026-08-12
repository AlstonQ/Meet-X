import { runDefaultLocalSimulation } from "./workflow.js";

const result = await runDefaultLocalSimulation();
console.log(JSON.stringify(result, null, 2));

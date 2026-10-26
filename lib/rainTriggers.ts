// Per-gauge flood-relevant rain thresholds (lib/model/rain-thresholds.json, produced by the forecast-model work) with the national
// fallback. The file is { "gauges": { "<gauge>": { "mm1h"?, "mm3h"?, "mm24h"? } } }: the mm over the gauge's response window that
// historically came before a rise. It may be empty; every gauge then uses the national numbers (lib/rainWords.ts).
import table from "./model/rain-thresholds.json";
import { triggersFor as pick, type RainThresholdTable, type RainTriggers } from "./rainWords";

export const rainTriggersFor = (station: string): RainTriggers => pick(station, table as RainThresholdTable);

// Known major dams and hydropower stations per basin.
//
// The SL Dept of Irrigation ArcGIS dataset only catalogues their own
// irrigation tanks (Reservoir_Data_2024), missing all the CEB / Mahaweli
// Authority hydropower reservoirs and stations that actually drive
// downstream flooding. This table is hand-curated from public sources
// (Mahaweli Authority, CEB, Wikipedia) and is the input for the
// "Connected dams" section on the dashboard.
//
// pucslPlantId — power plant ID in the PUCSL GenData API, which lets
// us pull live MW generation. IDs were reported by the CEB-feed
// research agent; verify before claiming high certainty in any one
// number.

export type Dam = {
  name: string;
  type: "hydropower-reservoir" | "hydropower-station" | "irrigation" | "diversion";
  capacityMCM?: number;
  pucslPlantId?: number;
  note?: string;
};

export const DAMS_BY_BASIN: Record<string, Dam[]> = {
  "Kelani Ganga": [
    { name: "Maussakele", type: "hydropower-reservoir", capacityMCM: 155, note: "Feeds Norton + New Laxapana via tunnels" },
    { name: "Castlereagh", type: "hydropower-reservoir", capacityMCM: 43, note: "Feeds Polpitiya + Wimalasurendra" },
    { name: "Norton", type: "hydropower-reservoir", capacityMCM: 3, note: "Pondage for Norton scheme" },
    { name: "Canyon", type: "hydropower-reservoir", capacityMCM: 3, note: "Pondage for Old Laxapana" },
    { name: "Old Laxapana", type: "hydropower-station", pucslPlantId: 3, note: "Tailrace into Maskeli Oya → Kelani" },
    { name: "Canyon (PS)", type: "hydropower-station", pucslPlantId: 4 },
    { name: "New Laxapana", type: "hydropower-station", pucslPlantId: 5 },
    { name: "Polpitiya", type: "hydropower-station", pucslPlantId: 7, note: "Tailrace into Kelani above Kithulgala" },
    { name: "Broadlands", type: "hydropower-station", pucslPlantId: 8, note: "Tailrace into Kelani above Glencourse" },
  ],
  "Mahaweli Ganga": [
    { name: "Kotmale", type: "hydropower-reservoir", capacityMCM: 170, pucslPlantId: 9, note: "Top of Mahaweli cascade" },
    { name: "Upper Kotmale", type: "hydropower-reservoir", pucslPlantId: 15 },
    { name: "Polgolla", type: "diversion", capacityMCM: 4, note: "Diverts Mahaweli flow north via tunnel to Bowatenna" },
    { name: "Bowatenna", type: "hydropower-reservoir", capacityMCM: 51, pucslPlantId: 14, note: "Receives Polgolla diversion → Amban Ganga" },
    { name: "Ukuwela", type: "hydropower-station", pucslPlantId: 13 },
    { name: "Victoria", type: "hydropower-reservoir", capacityMCM: 722, pucslPlantId: 10, note: "Largest reservoir in the cascade" },
    { name: "Randenigala", type: "hydropower-reservoir", capacityMCM: 875, pucslPlantId: 11, note: "Largest by capacity" },
    { name: "Rantembe", type: "hydropower-reservoir", capacityMCM: 22, pucslPlantId: 12, note: "Final dam in the upper cascade" },
    { name: "Moragahakanda", type: "hydropower-reservoir", note: "Newer, on Amban Ganga branch" },
  ],
  "Walawe Ganga": [
    { name: "Samanalawewa", type: "hydropower-reservoir", capacityMCM: 278, pucslPlantId: 17 },
    { name: "Udawalawe", type: "irrigation", capacityMCM: 268, note: "Major irrigation reservoir" },
  ],
  "Kalu Ganga": [
    { name: "Kukule Ganga", type: "hydropower-reservoir", pucslPlantId: 18, note: "On a Kalu Ganga tributary" },
  ],
};

/**
 * Demo dataset — 50 Singapore dogs.
 *
 * DEMO DATA. Addresses are real Singapore streets and developments with
 * plausible postal codes and approximate coordinates, but the dogs, owners,
 * emails and behavioural records are fictional. Behaviour colours, floor
 * capacities and the walker roster are synthetic demo values and are NOT
 * Doggie Retreat operational policy.
 *
 * Deliberately seeded so the engines have to show their reasoning:
 *   - 5 red dogs, 12 yellow, 27 green, 6 not yet assessed
 *   - 7 reciprocal incompatible pairs, some sharing days and some not
 *   - 7 multi-dog households (tests address-based stop grouping)
 *   - Monday attendance sits just above one-wave walker capacity
 */

import { FACILITY } from "@/config/facility";
import type {
  AppSettings,
  AttendanceException,
  BehaviorColor,
  Dog,
  DogConstraint,
  Floor,
  RecurringAttendance,
  Walker,
  Weekday,
} from "@/models/types";

type Row = [
  petId: string,
  name: string,
  owner: string,
  ownerId: string,
  email: string,
  breed: string,
  address: string,
  lat: number,
  lng: number,
  vax: string,
  days: Weekday[],
  pickup: boolean | null,
  dropoff: boolean | null,
  color: BehaviorColor | null,
  incompatible: string[],
  reviewed: boolean,
  age: number,
  notes: string
];

const BREED_WEIGHT: Record<string, number> = {
  "Toy Poodle": 4, "Singapore Special": 16, "Golden Retriever": 30, Maltese: 3,
  "Shih Tzu": 6, "Jack Russell Terrier": 7, "Miniature Schnauzer": 8,
  "Labrador Retriever": 32, "Border Collie": 19, Pomeranian: 3,
  "Siberian Husky": 25, Samoyed: 24, "Bichon Frise": 5, Beagle: 12,
  "Cavalier King Charles Spaniel": 8, "Silky Terrier": 4, "Shiba Inu": 10,
  "French Bulldog": 12, "Miniature Poodle": 6, "Pembroke Welsh Corgi": 12,
  "Yorkshire Terrier": 3, "German Shepherd": 34, Dachshund: 7, Havanese: 5,
  "Belgian Malinois": 28, Maltipoo: 5, Chihuahua: 2, Rottweiler: 45,
  "Japanese Spitz": 7, "Australian Shepherd": 22, "Miniature Pinscher": 4,
  "West Highland White Terrier": 8, "Cocker Spaniel": 13, Whippet: 12,
  Pug: 8, "Boston Terrier": 9, Cockapoo: 9,
};

const ROWS: Row[] = [
  ["P-403","Mochi","Tan Wei Ming","O-9823","weiming.tan@gmail.com","Toy Poodle","Blk 123 Ang Mo Kio Ave 6, #08-142, Singapore 560123",1.3691,103.8454,"Valid",["Mon","Wed","Fri"],true,true,"green",[],true,4,"Friendly with children; pulls on the leash during walks"],
  ["P-404","Bruno","Siti Nurhaliza Rahim","O-9824","siti.rahim@yahoo.com.sg","Singapore Special","Blk 856 Tampines St 82, #05-218, Singapore 520856",1.3496,103.9568,"Valid",["Tue","Thu"],false,false,"yellow",[],true,6,"Rescued through Project ADORE; sensitive to loud noises"],
  ["P-405","Simba","Rajesh Kumar","O-9825","rajesh.kumar88@gmail.com","Golden Retriever","17 Binjai Park, Singapore 589833",1.3350,103.7790,"Valid",["Mon","Tue","Wed","Thu","Fri"],true,true,null,[],false,3,"Needs weekly ear cleaning; loves swimming"],
  ["P-406","Peanut","Chloe Lim Hui Ting","O-9826","chloe.limht@outlook.com","Maltese","Parc Clematis, 2 Jalan Lempeng, #09-14, Singapore 128797",1.3110,103.7640,"Valid",["Wed"],false,true,"green",[],true,5,"Dental scaling due every six months"],
  ["P-407","Butter","Chloe Lim Hui Ting","O-9826","chloe.limht@outlook.com","Shih Tzu","Parc Clematis, 2 Jalan Lempeng, #09-14, Singapore 128797",1.3110,103.7640,"Due Soon",["Wed"],false,true,"green",[],true,7,"Prone to tear staining; wipe eyes daily"],
  ["P-408","Rocky","Muhammad Faizal Ismail","O-9827","faizal.ismail@gmail.com","Jack Russell Terrier","Blk 682 Hougang Ave 4, #03-91, Singapore 530682",1.3612,103.8863,"Valid",["Mon","Thu"],true,false,"yellow",[],true,2,"High energy; requires two walks daily"],
  ["P-409","Coco","Priya Menon","O-9828","priya.menon@hotmail.com","Miniature Schnauzer","Blk 325 Yishun Central, #12-334, Singapore 760325",1.4294,103.8350,"Expired",[],null,null,"green",[],false,8,"History of pancreatitis; strict low-fat diet"],
  ["P-410","Bailey","Jonathan Ng Kok Wei","O-9829","jonathan.ng@gmail.com","Labrador Retriever","Costa Del Sol, 100 Bayshore Rd, #14-02, Singapore 469978",1.3080,103.9330,"Valid",["Mon","Thu"],true,true,"green",["P-446"],true,6,"Overweight; on a measured feeding plan"],
  ["P-411","Ginger","Nurul Aisyah Binte Hassan","O-9830","nurul.aisyah@yahoo.com.sg","Singapore Special","Blk 289 Compassvale Cres, #09-45, Singapore 540289",1.3920,103.8950,"Valid",["Mon","Wed"],false,false,"yellow",[],true,4,"Fearful of umbrellas and brooms"],
  ["P-412","Max","Daniel Ong Boon Hwee","O-9831","daniel.ong@outlook.com","Border Collie","26 Greenleaf Rd, Singapore 279322",1.3230,103.7860,"Valid",["Mon","Tue","Wed","Thu","Fri"],true,true,"yellow",["P-430"],true,3,"Competes in agility; microchip verified 2024"],
  // Luna is fully enriched on purpose: the acceptance demo in the build spec
  // drives every step through her, so she has to appear in walks and floors.
  ["P-413","Luna","Michelle Chua Li Fen","O-9832","michelle.chua@gmail.com","Pomeranian","Blk 154 Bishan St 13, #07-88, Singapore 570154",1.3510,103.8480,"Valid",["Mon","Wed","Fri"],true,true,"green",[],true,5,"Luxating patella grade 2; avoid stairs"],
  ["P-414","Zeus","Arvind Pillai","O-9833","arvind.pillai@gmail.com","Siberian Husky","41 Namly Ave, Singapore 267213",1.3290,103.7830,"Valid",["Sat"],true,false,"yellow",["P-446"],true,4,"Heat intolerant; walks before 8 AM only"],
  ["P-415","Nala","Arvind Pillai","O-9833","arvind.pillai@gmail.com","Samoyed","41 Namly Ave, Singapore 267213",1.3290,103.7830,"Valid",["Sat"],true,false,"green",[],true,3,"Requires professional grooming every four weeks"],
  ["P-416","Bubbles","Grace Teo Sze Ling","O-9834","grace.teo@hotmail.com","Bichon Frise","Blk 55 Tiong Bahru Rd, #06-23, Singapore 160055",1.2860,103.8290,"Due Soon",[],null,null,null,[],false,7,"Allergic to chicken protein"],
  ["P-417","Rusty","Benjamin Koh Jun Hao","O-9835","ben.koh@gmail.com","Beagle","Parc Esta, 12 Sims Ave, #09-33, Singapore 387355",1.3190,103.8930,"Valid",["Tue","Thu"],true,true,"green",[],true,5,"Escape artist; check gate latch before release"],
  ["P-418","Comel","Fatimah Binte Osman","O-9836","fatimah.osman@yahoo.com.sg","Singapore Special","Blk 12 Haig Rd, #04-17, Singapore 380012",1.3120,103.8960,"Valid",["Mon","Fri"],null,null,"yellow",[],false,9,"Adopted at age five; slow to warm to strangers"],
  ["P-419","Daisy","Samantha Wong Mei Ling","O-9837","sam.wong@outlook.com","Cavalier King Charles Spaniel","Sky Habitat, 7 Bishan St 15, #23-11, Singapore 573842",1.3560,103.8480,"Valid",[],null,null,"green",[],false,6,"Heart murmur monitored annually"],
  ["P-420","Bobby","Kelvin Sim Chee Keong","O-9838","kelvin.sim@gmail.com","Silky Terrier","Blk 288 Bukit Batok East Ave 3, #10-402, Singapore 650288",1.3490,103.7500,"Expired",["Tue"],false,false,"red",["P-436"],true,8,"Bites during nail trims; muzzle recommended"],
  ["P-421","Kiara","Aparna Krishnan","O-9839","aparna.k@gmail.com","Shiba Inu","Whistler Grand, 105 West Coast Vale, #16-04, Singapore 126769",1.3120,103.7550,"Valid",["Mon","Wed","Fri"],true,true,"yellow",["P-426","P-435"],true,4,"Strong prey drive; keep leashed near cats"],
  ["P-422","Tank","Marcus Yeo Wei Jie","O-9840","marcus.yeo@hotmail.com","French Bulldog","Blk 78 Telok Blangah St 32, #05-119, Singapore 090078",1.2740,103.8180,"Valid",[],null,null,null,[],false,3,"Brachycephalic; avoid midday outdoor activity"],
  ["P-423","Bella","Hidayah Binte Zainal","O-9841","hidayah.zainal@gmail.com","Miniature Poodle","Kingsford Waterbay, 8 Upper Serangoon View, #07-21, Singapore 533758",1.3830,103.8990,"Valid",[],null,null,null,[],false,2,"Spayed 2023; no known allergies"],
  ["P-424","Milo","Hidayah Binte Zainal","O-9841","hidayah.zainal@gmail.com","Shih Tzu","Kingsford Waterbay, 8 Upper Serangoon View, #07-21, Singapore 533758",1.3830,103.8990,"Due Soon",[],null,null,null,[],false,6,"Chronic dry eye; apply drops twice daily"],
  ["P-425","Ollie","Ryan Tan Jia Le","O-9842","ryan.tanjl@outlook.com","Pembroke Welsh Corgi","Riverfront Residences, 27 Hougang Ave 7, #06-12, Singapore 538792",1.3720,103.8930,"Valid",["Mon","Wed"],true,true,"yellow",[],true,4,"Long-backed breed; discourage jumping off sofas"],
  ["P-426","Suki","Charmaine Loh Xin Yi","O-9843","charmaine.loh@gmail.com","Yorkshire Terrier","Blk 52 Stirling Rd, #08-64, Singapore 140052",1.2950,103.8010,"Valid",["Tue","Thu"],false,true,"green",["P-421"],true,5,"Weighs 2.8 kg; use an extra-small harness"],
  ["P-427","Duke","Nicholas Chan Wei Sheng","O-9844","nicholas.chan@yahoo.com.sg","German Shepherd","9 Frankel Ave, Singapore 458182",1.3170,103.9200,"Valid",["Mon","Tue","Wed","Thu","Fri"],true,true,"yellow",["P-439"],true,5,"Certified obedience trained; hip score on file"],
  ["P-428","Pepper","Deepa Ramasamy","O-9845","deepa.rama@gmail.com","Dachshund","Blk 235 Petir Rd, #09-127, Singapore 670235",1.3790,103.7620,"Expired",["Fri"],true,true,null,[],false,7,"Prior IVDD episode; ramp installed at home"],
  ["P-429","Momo","Jasmine Goh Pei Shan","O-9846","jasmine.goh@outlook.com","Havanese","Clavon, 6 Clementi Ave 1, #21-09, Singapore 129944",1.3160,103.7660,"Valid",["Wed"],null,null,null,[],false,3,"Anxious in carriers; sedative-free grooming preferred"],
  ["P-430","Rex","Adam Tan Zhi Hao","O-9847","adam.tanzh@gmail.com","Belgian Malinois","12 Sunset Drive, Singapore 597379",1.3220,103.7690,"Valid",["Sat"],false,false,"red",["P-412"],true,4,"Working-line temperament; handler-only recall"],
  ["P-431","Cookie","Serene Lau Hui Min","O-9848","serene.lau@hotmail.com","Maltipoo","The Florence Residences, 21 Hougang Ave 2, #12-08, Singapore 538815",1.3660,103.8900,"Valid",["Mon","Wed","Fri"],true,true,"green",[],true,3,"Regular anal gland expression required"],
  ["P-432","Cream","Serene Lau Hui Min","O-9848","serene.lau@hotmail.com","Toy Poodle","The Florence Residences, 21 Hougang Ave 2, #12-08, Singapore 538815",1.3660,103.8900,"Valid",["Mon","Wed","Fri"],true,true,"green",[],true,3,"Littermate of Cookie; feed separately to avoid guarding"],
  ["P-433","Caramel","Serene Lau Hui Min","O-9848","serene.lau@hotmail.com","Pomeranian","The Florence Residences, 21 Hougang Ave 2, #12-08, Singapore 538815",1.3660,103.8900,"Due Soon",["Mon","Wed","Fri"],true,true,"yellow",[],true,6,"Collapsing trachea; use a harness instead of a collar"],
  ["P-434","Bear","Zulkifli Bin Abdullah","O-9849","zul.abdullah@gmail.com","Singapore Special","Blk 888 Woodlands Dr 50, #11-56, Singapore 730888",1.4340,103.7900,"Valid",[],null,null,null,[],false,5,"Heartworm negative as of March 2026"],
  ["P-435","Nugget","Emily Foo Kai Xin","O-9850","emily.foo@outlook.com","Chihuahua","Blk 92 Whampoa Dr, #07-31, Singapore 320092",1.3260,103.8560,"Valid",["Mon","Wed"],false,false,"green",["P-421"],true,4,"Dislikes being picked up by strangers"],
  ["P-436","Thor","Vikram Nair","O-9851","vikram.nair@gmail.com","Rottweiler","18 Hillcrest Rd, Singapore 289002",1.3320,103.8080,"Valid",["Sat"],false,false,"red",["P-420"],true,4,"Muzzle required in public under licensing conditions"],
  ["P-437","Mika","Rachel Toh Yan Ling","O-9852","rachel.toh@gmail.com","Japanese Spitz","Blk 261 Serangoon Central Dr, #10-208, Singapore 550261",1.3510,103.8720,"Valid",[],null,null,null,[],false,2,"Sheds heavily twice a year; brush daily"],
  ["P-438","Scout","Desmond Lee Chee Meng","O-9853","desmond.lee@yahoo.com.sg","Australian Shepherd","Seaside Residences, 3 Siglap Link, #19-07, Singapore 448897",1.3070,103.9290,"Valid",["Mon","Tue","Wed","Thu","Fri"],true,true,"green",[],true,3,"Needs mental enrichment; puzzle feeder used"],
  ["P-439","Tiny","Nadiah Binte Sulaiman","O-9854","nadiah.sulaiman@gmail.com","Miniature Pinscher","Blk 456 Pasir Ris Dr 6, #06-88, Singapore 510456",1.3720,103.9440,"Expired",["Thu"],false,false,"red",["P-427"],true,6,"Reactive to skateboards and bicycles"],
  ["P-440","Snowy","Alvin Tay Beng Huat","O-9855","alvin.tay@outlook.com","West Highland White Terrier","30 Chuan Drive, Singapore 554662",1.3560,103.8680,"Valid",["Mon","Wed"],null,null,null,[],false,7,"Atopic dermatitis; medicated shampoo weekly"],
  ["P-441","Patch","Alvin Tay Beng Huat","O-9855","alvin.tay@outlook.com","Jack Russell Terrier","30 Chuan Drive, Singapore 554662",1.3560,103.8680,"Valid",["Mon","Wed"],null,null,null,[],false,5,"Neutered 2024; excellent recall off leash"],
  ["P-442","Hazel","Clarissa Ho Wen Xuan","O-9856","clarissa.ho@gmail.com","Cocker Spaniel","Botanique at Bartley, 20 Upper Paya Lebar Rd, #08-15, Singapore 534986",1.3420,103.8830,"Due Soon",[],null,null,null,[],false,4,"Recurring ear infections; dry ears after swimming"],
  ["P-443","Raja","Shanti Devi Raj","O-9857","shanti.raj@hotmail.com","Singapore Special","Blk 115 Jalan Bukit Merah, #04-72, Singapore 150115",1.2830,103.8180,"Valid",["Fri"],true,true,"yellow",[],true,8,"Three-legged after a 2022 road accident; short walks only"],
  ["P-444","Bolt","Terence Phua Kian Seng","O-9858","terence.phua@gmail.com","Whippet","Grandeur Park Residences, 5 New Upper Changi Rd, #13-06, Singapore 462811",1.3250,103.9460,"Valid",[],null,null,"green",[],false,3,"Thin coat; needs a jacket in air-conditioned clinics"],
  ["P-445","Pudding","Amanda Seah Li Wen","O-9859","amanda.seah@outlook.com","Pug","Blk 55 Marine Terrace, #09-244, Singapore 440055",1.3060,103.9160,"Expired",[],null,null,null,[],false,6,"Brachycephalic airway syndrome; corrective surgery advised"],
  ["P-446","Tommy","Haziq Bin Roslan","O-9860","haziq.roslan@gmail.com","Singapore Special","Blk 512 Jurong West St 52, #08-166, Singapore 640512",1.3480,103.7190,"Valid",["Mon","Thu"],false,false,"red",["P-410","P-414"],true,5,"Resource guards food bowl; feed in a separate room"],
  ["P-447","Latte","Valerie Chin Hui Shan","O-9861","valerie.chin@gmail.com","Golden Retriever","Normanton Park, 8 Normanton Park, #17-03, Singapore 118996",1.2900,103.7900,"Valid",["Mon","Tue","Wed","Thu","Fri"],true,true,"green",[],true,4,"Hip dysplasia screening scheduled for June 2026"],
  ["P-448","Espresso","Valerie Chin Hui Shan","O-9861","valerie.chin@gmail.com","Labrador Retriever","Normanton Park, 8 Normanton Park, #17-03, Singapore 118996",1.2900,103.7900,"Valid",["Mon","Tue","Wed","Thu","Fri"],true,true,"green",[],true,5,"Trained as a therapy dog; certification renewed 2026"],
  ["P-449","Buddy","Gerald Neo Wei Xiang","O-9862","gerald.neo@yahoo.com.sg","Boston Terrier","Blk 123 Bedok North St 2, #05-49, Singapore 460123",1.3320,103.9310,"Due Soon",[],null,null,"green",[],false,4,"Snores loudly; monitor for breathing distress"],
  ["P-450","Charlie","Melissa D'Cruz","O-9863","melissa.dcruz@gmail.com","Cockapoo","3 Rambai Rd, Singapore 424716",1.3160,103.9060,"Valid",[],null,null,null,[],false,3,"Non-shedding coat; clipped every eight weeks"],
  ["P-451","Roxy","Andrew Lim Kok Leong","O-9864","andrew.limkl@outlook.com","Miniature Schnauzer","Reflections at Keppel Bay, 3 Keppel Bay View, #15-08, Singapore 098422",1.2660,103.8100,"Valid",["Tue","Thu"],false,true,"green",[],true,6,"Elevated triglycerides; annual bloodwork"],
  ["P-452","Sasha","Andrew Lim Kok Leong","O-9864","andrew.limkl@outlook.com","Border Collie","Reflections at Keppel Bay, 3 Keppel Bay View, #15-08, Singapore 098422",1.2660,103.8100,"Valid",["Tue","Thu"],false,true,"yellow",[],true,4,"Herds children; supervise around toddlers"],
];

/** Demo constraints. Synthetic values, clearly not Doggie Retreat policy. */
const DEMO_CONSTRAINTS: Record<string, DogConstraint[]> = {
  "P-443": [{
    id: "c-raja-1",
    type: "excused_from_walk",
    description: "Three legs — daycare only, no group walk. Demo value.",
    severity: "hard",
  }],
  "P-445": [{
    id: "c-pudding-1",
    type: "excused_from_walk",
    description: "Brachycephalic airway syndrome — no group walk. Demo value.",
    severity: "hard",
  }],
  "P-421": [{
    id: "c-kiara-1",
    type: "max_group_size",
    description: "Selective around small dogs — cap group at 2. Demo value.",
    severity: "hard",
    value: 2,
  }],
  "P-427": [{
    id: "c-duke-1",
    type: "requires_experienced_walker",
    description: "Large working breed — experienced handler. Demo value.",
    severity: "hard",
  }],
  "P-436": [{
    id: "c-thor-1",
    type: "requires_experienced_walker",
    description: "Muzzle required in public under licensing. Demo value.",
    severity: "hard",
  }],
};

export const DEMO_EPOCH = "2020-01-01";

export function buildDemoDogs(): Dog[] {
  return ROWS.map((r) => ({
    id: r[0],
    collarId: r[0],
    collarOwnerId: r[3],
    name: r[1],
    ownerName: r[2],
    breed: r[5],
    age: r[16],
    weightKg: BREED_WEIGHT[r[5]],
    address: r[6],
    lat: r[7],
    lng: r[8],
    vaccinationStatus: r[9],
    behaviorColor: r[13],
    incompatibleDogIds: [...r[14]],
    conflictsReviewed: r[15],
    constraints: DEMO_CONSTRAINTS[r[0]] ? [...DEMO_CONSTRAINTS[r[0]]] : [],
    defaultPickup: r[11],
    defaultDropoff: r[12],
    personalityNotes: r[17],
    operationalNotes: "",
    active: true,
    isDemo: true,
  }));
}

export function buildDemoAttendance(): RecurringAttendance[] {
  const out: RecurringAttendance[] = [];
  ROWS.forEach((r) => {
    r[10].forEach((day) => {
      out.push({
        id: `${r[0]}-${day}`,
        dogId: r[0],
        weekday: day,
        activeFrom: DEMO_EPOCH,
      });
    });
  });
  return out;
}

export function buildDemoExceptions(): AttendanceException[] {
  return [];
}

export function buildDemoWalkers(): Walker[] {
  return [
    { id: "w-sarah", name: "Sarah", available: true, experienced: true, experienceNotes: "Lead handler. Comfortable with large and reactive dogs.", isDemo: true },
    { id: "w-marcus", name: "Marcus", available: true, experienced: true, experienceNotes: "Five years with working breeds.", isDemo: true },
    { id: "w-mei", name: "Mei", available: true, experienced: false, experienceNotes: "Strong with small and senior dogs.", isDemo: true },
    { id: "w-daniel", name: "Daniel", available: true, experienced: false, experienceNotes: "Recently joined; building confidence.", isDemo: true },
    { id: "w-aisha", name: "Aisha", available: true, experienced: true, experienceNotes: "Handles the muzzle-trained roster.", isDemo: true },
  ];
}

export function buildDemoFloors(): Floor[] {
  return [
    { id: "f1", name: "Floor 1", capacity: 12, order: 1, restrictions: "Ground level, direct yard access. Demo capacity.", isDemo: true },
    { id: "f2", name: "Floor 2", capacity: 10, order: 2, restrictions: "Main play hall. Demo capacity.", isDemo: true },
    { id: "f3", name: "Floor 3", capacity: 8, order: 3, restrictions: "Quiet floor, smaller rooms. Demo capacity.", isDemo: true },
  ];
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: "singleton",
  maxDogsPerWalker: 4,
  facilityName: FACILITY.name,
  facilityAddress: FACILITY.address,
  facilityLat: FACILITY.lat,
  facilityLng: FACILITY.lng,
  vanCount: 2,
  vanCapacity: null,
  redVanPolicy: "review",
  demoDataLoaded: false,
};

/**
 * A Collar-shaped export of the same 50 dogs — basic fields only, no
 * enrichment. Used as the import fixture so the mapping step and the
 * "reimport must not destroy enriched data" rule are both testable.
 */
export function buildCollarCsvFixture(): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = [
    "Owner_ID", "Owner_Name", "Owner_Email", "Pet_ID", "Pet_Name",
    "Species", "Breed", "Pet_Address", "Vaccination_Status", "Notes",
  ].join(",");
  const lines = ROWS.map((r) =>
    [r[3], r[2], r[4], r[0], r[1], "Dog", r[5], r[6], r[9], r[17]].map(q).join(",")
  );
  return [header, ...lines].join("\n");
}

import { buildActivityTextQuery } from "../lib/googlePlaces";

type TestCase = {
  id: string;
  destination: string;
  style: string;
  options?: Parameters<typeof buildActivityTextQuery>[2];
  expected: string;
};

const testCases: TestCase[] = [
  {
    id: "AQ1",
    destination: "Banff, Alberta",
    style: "chill",
    options: {
      activityFocus: "hiking",
      requestedActivityName: "Johnston Canyon to Upper Falls",
    },
    expected: "Johnston Canyon to Upper Falls hiking trail in Banff, Alberta",
  },
  {
    id: "AQ2",
    destination: "Banff, Alberta",
    style: "adventure",
    options: {
      requestedActivityName: "Johnston Canyon",
    },
    expected: "Johnston Canyon in Banff, Alberta",
  },
  {
    id: "AQ3",
    destination: "Banff, Alberta",
    style: "adventure",
    options: {
      activityFocus: "skiing",
    },
    expected:
      "top ski resorts, ski hills, lift-access skiing, chairlifts, gondolas, and nordic skiing in Banff, Alberta",
  },
];

let failed = 0;

for (const testCase of testCases) {
  const actual = buildActivityTextQuery(
    testCase.destination,
    testCase.style,
    testCase.options
  );

  if (actual !== testCase.expected) {
    failed += 1;
    console.error(`[${testCase.id}] Expected: ${testCase.expected}`);
    console.error(`[${testCase.id}] Actual:   ${actual}`);
  } else {
    console.log(`[${testCase.id}] PASS`);
  }
}

if (failed > 0) {
  process.exit(1);
}

console.log(`Activity query tests passed (${testCases.length}/${testCases.length}).`);

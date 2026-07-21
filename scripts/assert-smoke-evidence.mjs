/* global fetch */

const response = await fetch("http://127.0.0.1:4010/evidence", {
  headers: { Authorization: "Bearer local-smoke-token" },
});
const evidence = await response.json();

if (evidence.length !== 1 || evidence[0][1].polls < 2) {
  throw new Error("Expected one ARM start and at least two status polls.");
}

console.log(
  `ARM evidence: ${evidence.length} start, ${evidence[0][1].polls} polls`,
);

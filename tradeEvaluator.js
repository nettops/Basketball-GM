// Weights unrealized potential more heavily for younger players, tapering to
// near-zero by the mid-30s (a 34-year-old's potential gap isn't going anywhere).
function youthFactor(age) {
  if (age <= 23) return 1.0;
  if (age >= 34) return 0.1;
  return 1.0 - ((age - 23) / 11) * 0.9;
}

// "Fair" salary scales roughly linearly with overall; burden is how far actual
// salary exceeds that anchor, converted to value-scale penalty points.
function contractBurden(salary, overall) {
  const fairSalary = Math.max(1000000, (overall - 50) * 1000000);
  const excess = Math.max(0, salary - fairSalary);
  return excess / 2000000;
}

function basePlayerValue(player) {
  const potentialGap = Math.max(0, player.potential - player.overall);
  return player.overall * 2 + potentialGap * youthFactor(player.age) - contractBurden(player.contract.salary, player.overall);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { youthFactor: youthFactor, contractBurden: contractBurden, basePlayerValue: basePlayerValue };
}

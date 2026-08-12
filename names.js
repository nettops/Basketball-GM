// Every generated name in the game comes from here.
//
// It exists because three separate generators each drew a first name and a last
// name independently from a fifteen-by-fifteen list and never checked whether
// the result was already in use. Two hundred and twenty-five possible names,
// sixty prospects a draft: the birthday problem guarantees collisions, and the
// measurements were exactly what it predicts — seven repeats in a single class,
// and over twenty classes 859 surplus copies, including twelve separate players
// named Andre Bell. Coaches (225 combinations) and commissioner filler players
// (144) had the same defect.
//
// Two changes fix it and both are needed. The pools are large enough that names
// stay fresh across a fifty-season save, and pickUniqueName REFUSES to hand out
// a name already taken. The pool size alone would only make collisions rarer;
// the check is what makes them impossible.
//
// A leaf module by design — it requires nothing, so any generator can use it
// without a load-order or cycle problem. Callers own the set of names already
// in use and pass it in.

// Names are deliberately drawn from a wide range of origins: the league drafts
// from everywhere, and a pool that all sounds the same reads as repetitive long
// before any name literally repeats.
const PLAYER_FIRST_NAMES = [
  'Jaylen', 'Marcus', 'Devin', 'Isaiah', 'Elijah', 'Cameron', 'Xavier', 'Malik',
  'Tyler', 'Andre', 'DeAndre', 'Josiah', 'Amari', 'Jalen', 'Caleb',
  'Trey', 'Jamal', 'Darius', 'Terrance', 'Quentin', 'Rashawn', 'Kelvin',
  'Dominic', 'Bryce', 'Corey', 'Julian', 'Miles', 'Nolan', 'Preston', 'Reggie',
  'Sterling', 'Tobias', 'Vincent', 'Wesley', 'Zion', 'Ayo', 'Bilal', 'Chidi',
  'Dejounte', 'Emeka', 'Gideon', 'Hakim', 'Ibrahim', 'Jabari', 'Kofi',
  'Lamont', 'Micah', 'Nasir', 'Omari', 'Parker', 'Rasheed', 'Solomon', 'Tariq',
  'Vernon', 'Yusuf', 'Zaire', 'Anton', 'Brady', 'Colton', 'Dax', 'Eli',
  'Finn', 'Grayson', 'Hudson', 'Ivan', 'Jonah', 'Kai', 'Landon', 'Mason',
  'Nico', 'Owen', 'Pierce', 'Quinn', 'Rhys', 'Silas', 'Theo', 'Weston',
  'Ezra', 'Beckett', 'Cassius', 'Emmett', 'Henrik', 'Ilya', 'Kristaps',
  'Luka', 'Mateo', 'Nikola', 'Oskar', 'Pavel', 'Rafael', 'Santiago', 'Tomas',
  'Viktor', 'Yannick', 'Zoran', 'Adrian', 'Bogdan', 'Dario', 'Evan', 'Franz',
  'Goran', 'Hugo', 'Kenyon', 'Lonnie', 'Malachi', 'Nikolai', 'Obadiah',
  'Rondell', 'Shawn', 'Tevin', 'Wendell', 'Deshawn', 'Kwame', 'Rui'
];

const PLAYER_LAST_NAMES = [
  'Turner', 'Brooks', 'Hayes', 'Coleman', 'Reid', 'Bryant', 'Foster',
  'Simmons', 'Ward', 'Price', 'Bell', 'Owens', 'Hunt', 'Mercer', 'Dawson',
  'Abbott', 'Barnett', 'Caldwell', 'Duncan', 'Ellison', 'Fletcher', 'Gaines',
  'Harrington', 'Ingram', 'Jennings', 'Kirkland', 'Lawson', 'Maddox',
  'Norwood', 'Oakley', 'Patterson', 'Quinlan', 'Rollins', 'Sutton',
  'Underwood', 'Vaughn', 'Whitaker', 'Yates', 'Zimmerman', 'Alvarez',
  'Bautista', 'Cabrera', 'Delgado', 'Escobar', 'Fuentes', 'Guerrero',
  'Herrera', 'Iglesias', 'Jimenez', 'Lozano', 'Medina', 'Navarro', 'Ortega',
  'Pacheco', 'Quintero', 'Ramos', 'Salazar', 'Trevino', 'Valdez', 'Zamora',
  'Baptiste', 'Chukwu', 'Diallo', 'Fofana', 'Gueye', 'Hassan', 'Jalloh',
  'Kone', 'Mensah', 'Ndiaye', 'Sesay', 'Toure', 'Bergman', 'Christensen',
  'Dahl', 'Eriksen', 'Falk', 'Halvorsen', 'Isaksen', 'Jokinen', 'Karlsson',
  'Lindholm', 'Nyberg', 'Rasmussen', 'Sandberg', 'Thorsen', 'Virtanen',
  'Walsh', 'Doherty', 'Kavanagh', 'Mulligan', 'Sheridan', 'Bianchi', 'Costa',
  'Lombardi', 'Ricci', 'Novak', 'Petrovic', 'Simic', 'Vukovic', 'Kowalski',
  'Nowak', 'Okonkwo', 'Bergstrom', 'Ferreira', 'Haddad', 'Lindqvist', 'Osei',
  'Marchetti', 'Nakamura', 'Duval', 'Petrov', 'Ellington', 'Vasquez'
];

// Coaches keep their own pool. The distinction was deliberate before this file
// existed and it still reads better: a coach should sound like a coach, not
// like a player who stopped playing.
const COACH_FIRST_NAMES = [
  'Gregg', 'Erik', 'Steve', 'Nate', 'Monty', 'Chauncey', 'Ime', 'Mike', 'Joe',
  'Will', 'Taylor', 'Charles', 'Quin', 'Frank', 'Dawn',
  'Adrian', 'Bernard', 'Curtis', 'Dennis', 'Edwin', 'Gordon', 'Harold',
  'Irving', 'Jerome', 'Keith', 'Leonard', 'Marvin', 'Norman', 'Oscar',
  'Percy', 'Ronald', 'Stanley', 'Terrence', 'Walter', 'Alonzo', 'Byron',
  'Clyde', 'Doug', 'Elgin', 'Fred', 'Glen', 'Jack', 'Kevin', 'Larry',
  'Maurice', 'Nick', 'Pat', 'Rick', 'Sam', 'Tom', 'Wes', 'Zach', 'Lorraine',
  'Becky', 'Teresa'
];

const COACH_LAST_NAMES = [
  'Sorensen', 'Whitfield', 'Mercer', 'Bradley', 'Holloway', 'Vance', 'Griggs',
  'Donovan', 'Castillo', 'Reyes', 'Pierce', 'Lindgren', 'Okafor', 'Mathis',
  'Sanborn', 'Ashford', 'Blackwell', 'Cornish', 'Dunleavy', 'Everett',
  'Fitzgerald', 'Galloway', 'Hargrove', 'Ivers', 'Jessup', 'Kilgore',
  'Langston', 'Northcutt', 'Ogden', 'Prescott', 'Radcliffe', 'Stoddard',
  'Thurman', 'Vandenberg', 'Wexler', 'Yarborough', 'Ackerman', 'Bidwell',
  'Caruthers', 'Denning', 'Ellsworth', 'Farnsworth', 'Goodwin', 'Hollins'
];

const PLAYER_NAME_POOLS = { first: PLAYER_FIRST_NAMES, last: PLAYER_LAST_NAMES };
const COACH_NAME_POOLS = { first: COACH_FIRST_NAMES, last: COACH_LAST_NAMES };

// Case- and spacing-insensitive, so "Andre  Bell" and "andre bell" cannot slip
// past each other as two different people.
function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Builds the set of names already spoken for. Pass every list that matters —
// for players that is the active league AND the retiree archive, because a
// prospect arriving with a Hall of Famer's exact name is the same defect
// wearing a longer timescale.
function takenNameSet() {
  const taken = Object.create(null);
  for (let i = 0; i < arguments.length; i++) {
    (arguments[i] || []).forEach(function (entry) {
      const name = typeof entry === 'string' ? entry : (entry && entry.name);
      if (name) taken[normalizeName(name)] = true;
    });
  }
  return taken;
}

function isNameTaken(taken, name) {
  return !!taken[normalizeName(name)];
}

function claimName(taken, name) {
  taken[normalizeName(name)] = true;
  return name;
}

// How many random draws before falling back to an exhaustive walk. Random
// draws are the common path; the walk exists so that a nearly-full pool still
// terminates with a real answer instead of looping or handing back a duplicate.
const NAME_DRAW_ATTEMPTS = 40;

function pickUniqueName(rng, taken, pools) {
  // A `taken` that is not an object silently disables the entire guarantee:
  // every lookup returns undefined, nothing is ever seen as taken, and the
  // function happily hands back duplicates while looking like it works. This
  // was not hypothetical — a caller passed a league year here by mistake and
  // the only symptom was repeated names. Fail loudly instead.
  if (!taken || typeof taken !== 'object') {
    throw new TypeError('pickUniqueName needs a taken-name set from takenNameSet(), got ' + typeof taken);
  }
  const p = pools || PLAYER_NAME_POOLS;
  for (let i = 0; i < NAME_DRAW_ATTEMPTS; i++) {
    const name = p.first[Math.floor(rng() * p.first.length)] + ' ' +
      p.last[Math.floor(rng() * p.last.length)];
    if (!isNameTaken(taken, name)) return claimName(taken, name);
  }

  // Every random draw collided, so the pool is crowded. Walk the whole
  // cross-product from a random offset and take the first name free. Starting
  // at an offset rather than at zero keeps the fallback from always producing
  // the same alphabetical run once a save gets old.
  const total = p.first.length * p.last.length;
  const start = Math.floor(rng() * total);
  for (let k = 0; k < total; k++) {
    const idx = (start + k) % total;
    const name = p.first[idx % p.first.length] + ' ' +
      p.last[Math.floor(idx / p.first.length) % p.last.length];
    if (!isNameTaken(taken, name)) return claimName(taken, name);
  }

  // Genuinely exhausted — every combination is in use. Numbering is ugly, but
  // it is honest and it terminates; silently returning a duplicate is the bug
  // this file exists to remove.
  let n = 2;
  const base = p.first[Math.floor(rng() * p.first.length)] + ' ' +
    p.last[Math.floor(rng() * p.last.length)];
  while (isNameTaken(taken, base + ' ' + toRoman(n))) n++;
  return claimName(taken, base + ' ' + toRoman(n));
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
function toRoman(n) { return ROMAN[n] || String(n); }

function firstNameOfName(name) { return String(name).trim().split(/\s+/)[0]; }

// "Jr." and the numerals are suffixes, not surnames.
const NAME_SUFFIXES = ['jr.', 'jr', 'sr.', 'sr', 'ii', 'iii', 'iv', 'v'];
function surnameOfName(name) {
  const parts = String(name).trim().split(/\s+/);
  let i = parts.length - 1;
  while (i > 0 && NAME_SUFFIXES.indexOf(parts[i].toLowerCase()) !== -1) i--;
  return parts[i];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLAYER_FIRST_NAMES: PLAYER_FIRST_NAMES,
    PLAYER_LAST_NAMES: PLAYER_LAST_NAMES,
    COACH_FIRST_NAMES: COACH_FIRST_NAMES,
    COACH_LAST_NAMES: COACH_LAST_NAMES,
    PLAYER_NAME_POOLS: PLAYER_NAME_POOLS,
    COACH_NAME_POOLS: COACH_NAME_POOLS,
    normalizeName: normalizeName,
    takenNameSet: takenNameSet,
    isNameTaken: isNameTaken,
    claimName: claimName,
    pickUniqueName: pickUniqueName,
    firstNameOfName: firstNameOfName,
    surnameOfName: surnameOfName
  };
}

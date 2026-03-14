/**
 * Words ending in '-ly' that should NOT be flagged as adverbs.
 * Includes nouns, adjectives, proper names, and words where -ly
 * is part of the root rather than an adverb suffix.
 * Compiled from standard English dictionaries and editorial review.
 */
export const ADVERB_EXCLUSIONS: Record<string, 1> = {
  // Common adjectives ending in -ly
  costly: 1, courtly: 1, cowardly: 1, cuddly: 1, curly: 1, daily: 1,
  dastardly: 1, deadly: 1, deathly: 1, disorderly: 1, early: 1, elderly: 1,
  friendly: 1, gangly: 1, ghastly: 1, giggly: 1, goodly: 1, gravelly: 1,
  grisly: 1, heavenly: 1, hilly: 1, holy: 1, homely: 1, hourly: 1,
  kindly: 1, lively: 1, lonely: 1, lovely: 1, lowly: 1, manly: 1,
  measly: 1, melancholy: 1, monthly: 1, nightly: 1, oily: 1, only: 1,
  orderly: 1, pearly: 1, prickly: 1, quarterly: 1, shapely: 1, sickly: 1,
  silly: 1, sly: 1, sparkly: 1, spritely: 1, squiggly: 1, stately: 1,
  steely: 1, surly: 1, timely: 1, ugly: 1, unlikely: 1, unruly: 1,
  weekly: 1, wobbly: 1, woolly: 1, worldly: 1, wrinkly: 1, yearly: 1,

  // Nouns ending in -ly
  ally: 1, anomaly: 1, assembly: 1, belly: 1, billy: 1, bully: 1,
  butterfly: 1, dolly: 1, dragonfly: 1, family: 1, firefly: 1, fly: 1,
  folly: 1, gadfly: 1, gully: 1, hillbilly: 1, holly: 1, homily: 1,
  horsefly: 1, jelly: 1, jolly: 1, lily: 1, lolly: 1, molly: 1,
  monopoly: 1, panoply: 1, polly: 1, potbelly: 1, rally: 1, sally: 1,
  supply: 1, tally: 1, underbelly: 1,

  // Verbs ending in -ly
  apply: 1, comply: 1, imply: 1, multiply: 1, rely: 1, reply: 1,

  // Names ending in -ly (not already in nouns above)
  emily: 1, kelly: 1, willy: 1,

  // Adverbs that are too common / too useful to flag
  actually: 1, additionally: 1, allegedly: 1, alternatively: 1,
  approximately: 1, completely: 1, consequently: 1, currently: 1,
  definitely: 1, especially: 1, exactly: 1, exclusively: 1, finally: 1,
  generally: 1, globally: 1, immediately: 1, lately: 1, likely: 1,
  luckily: 1, mentally: 1, particularly: 1, partly: 1, politically: 1,
  presumably: 1, previously: 1, rarely: 1, recently: 1, reportedly: 1,
  roughly: 1, shortly: 1, unfortunately: 1, usually: 1, wholly: 1,

  // stet additions — words we've seen cause false positives
  bodily: 1, bristly: 1, bubbly: 1, burly: 1, chilly: 1, comely: 1,
  crinkly: 1, crumbly: 1, doily: 1, frilly: 1, jiggly: 1, pebbly: 1,
  scaly: 1, smelly: 1, spindly: 1,

  // Country/place names
  italy: 1, sicily: 1,

  // Month
  july: 1,
};

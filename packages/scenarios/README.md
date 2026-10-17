# Scenarios

`@pb/scenarios` exports `ScenarioSchema`, inferred input/output types, `defineScenario`, `defaultTuning`, `resolveTuning`, `scenarios`, `scenarioIds`, `isScenarioId` and `getScenario`. `@pb/scenarios/testing` exports the small, hand-checkable `testScenario`, which is intentionally not registered.

The `uk` registry entry now has identity `uk`, not the previous Testland placeholder. It contains 12 named UK regions with schematic SVG paths and label anchors, 3 classes, 3 age groups, 108 complete demographic segments, 5 issues, 7 bounded event templates, 4 backgrounds and an opening world description. The 100 seats, population shares, voter attitudes and map are explicitly **stylized game data**, not real electoral boundaries, demographic estimates or a current election forecast. Parties and candidates are fictional/player-created.

Use `scenario.map.viewBox` and each region's `path`, `label`, `name` and `id` directly for the web map. Use `scenario.meta.blurb` to explain the simplification. Default simulation population is 20,000 numeric voters; AI cost does not depend on this population size. The UK scenario uses the simplified `fptp-regions` system: the regional winner takes that region's seats, not a real constituency tally.

Add a new scenario folder, validate its data with `defineScenario`, and add one registry entry. Issue, region, segment, template and background ids are the source of truth for AI enums; consumers must not hard-code Testland ids. Partial tuning overrides replace complete nested objects, so overriding `costs` or `corruptionRisk` requires every key in that object.

Validation checks unique ids, known references, national/regional population totals, complete issue vectors, normalized nonnegative salience, meaningful target filters, ordered age/stat ranges and nondecreasing corruption risk by size. Reserved ids and ambiguous region/segment id collisions are rejected. Scenario data is immutable by convention; the simulation caches lookup tables by scenario object identity. Create/parse a new scenario object when changing tuning, rather than mutating one already in use.

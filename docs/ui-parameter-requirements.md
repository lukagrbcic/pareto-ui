# PARETO UI Parameter and Run-Completeness Report

This report summarizes what PARETO UI asks the user to enter, which inputs are
required for a scenario to be considered complete, and which additional checks
separate completeness from a successful optimization.

The backend validator is the source of truth. The generic table editor accepts
blank and temporarily invalid cells so that users can save work in progress;
requiredness is enforced later by scenario readiness and optimization launch.

## Executive summary

A basic scenario does **not** require every facility type or every table shown in
the sidebar. The smallest maintained example is:

```text
Production pad -> network node -> disposal site
```

For that example, the user needs:

1. A scenario name and an Excel or map input file.
2. At least one production/flowback source and at least one destination.
3. A nonempty planning horizon and positive production or flowback somewhere in
   that horizon.
4. A valid directed route from each producing pad to a final destination.
5. Applicable capacities, operating availability, costs, economics, units, and
   infrastructure options.
6. Enough connected capacity to carry the forecast flow.
7. Supported enum-like optimization settings. Runtime, optimality gap, solver
   availability, scaling, and slack choices are not comprehensively validated by
   readiness and can still fail or behave unexpectedly during the solve.

Completions pads, external water, storage, treatment, beneficial reuse, trucking,
water quality, hydraulics, desalination, emissions, subsurface risk, and
infrastructure timing are conditional features. Their parameters become required
only when the related facilities, routes, objective, or advanced modes are used.

The main implementation is in
[`scenario_validation.py`](../backend/app/internal/validation/scenario_validation.py).

## What "complete" means

PARETO UI has several different levels of readiness. They should not be treated
as synonyms.

| Level | Meaning | Enforced by |
| --- | --- | --- |
| Inputs complete | Deterministic validation found no blocking errors. Warnings and documented defaults may remain. | `GET /scenario_readiness/{id}` |
| Model builds | Project PARETO accepted the selected formulation, tables, units, and fixed overrides. | **Validate Scenario** |
| Feasible plan found | A separate 20-second solve found and verified a solution with slack variables disabled. | **Check feasibility** |
| Optimization accepted | The run endpoint repeated deterministic validation and reserved the run. | **Optimize** / `POST /run_model` |
| Successful run | The full solve returned a verified feasible incumbent and report generation succeeded. | Background optimization worker |

Important consequences:

- **Inputs complete is not proof that the model builds or is feasible.**
- Advancing a map scenario to Optimization Setup requires current validation with
  `model_check="passed"`, but does not require a successful quick feasibility
  check ([`scenarios.py:127-139`](../backend/app/routers/scenarios.py#L127-L139)).
- The actual run endpoint repeats deterministic validation, but does not require a
  previous model-build or feasibility result
  ([`scenarios.py:325-362`](../backend/app/routers/scenarios.py#L325-L362)).
- A feasible result at the time limit can be accepted without being proven
  optimal.

See [`scenario-validation.md`](scenario-validation.md#what-the-checks-establish)
for the detailed evidence levels.

## Requirement labels used below

| Label | Meaning |
| --- | --- |
| **Required** | Missing or invalid data blocks deterministic completeness. |
| **Conditional** | Required only when the associated facility, route, or setting is present. |
| **Default/warning** | A blank is accepted using a documented model assumption, but the UI asks the user to review it. |
| **Optional** | Does not block the basic formulation unless another selection makes it applicable. |

## 1. Scenario creation inputs

| UI input | Internal use | Requirement |
| --- | --- | --- |
| Scenario Name | Persisted scenario `name` | **Required** to create a scenario; empty names are rejected in the frontend. |
| Input file | `.xlsx`, `.kml`, `.kmz`, or zipped shapefiles | **Required** to create a scenario. |
| Default Node Type For This Map | Initial classification for imported map points | **Required for map import**, but always has the `NetworkNode` default. It is not used for Excel imports. |

An Excel import starts as `Draft`; a map import starts as `Incomplete`. Both get
the same base optimization defaults
([`scenario_handler.py:235-278`](../backend/app/internal/scenario_handler.py#L235-L278)).

### Excel versus map behavior

- Excel-only scenarios are supported; `map_data` is not required.
- Map imports provide geometry, names, classifications, and connections, but do
  not provide a complete model by themselves.
- Blank `PadRates`, `CompletionsDemand`, and `FlowbackRates` cells in an imported
  Excel scenario mean zero and generate warnings.
- The same forecast blanks in a map-origin scenario are blocking errors.

The different blank handling is implemented at
[`scenario_validation.py:159-177`](../backend/app/internal/validation/scenario_validation.py#L159-L177).

## 2. Network and facility inputs

### Base set requirements

The canonical facility sets are:

```text
ProductionPads
CompletionsPads
NetworkNodes
SWDSites
StorageSites
TreatmentSites
ExternalWaterSources
ReuseOptions
```

The user must supply or classify:

- At least one `ProductionPads` or `CompletionsPads` member.
- At least one destination among `CompletionsPads`, `SWDSites`, `StorageSites`,
  or `ReuseOptions`.
- Unique, nonblank identifiers.
- Each facility identifier in exactly one facility set.
- Table indices that refer only to known members of their corresponding sets.

These rules are enforced at
[`scenario_validation.py:107-157`](../backend/app/internal/validation/scenario_validation.py#L107-L157).

### Map editor fields

The map editor asks for common node fields:

| UI field | Internal data | Requirement |
| --- | --- | --- |
| Name | Node or pipeline identifier | **Required** and must be unique in the map editor. |
| Node Type | Facility-set classification | **Required** for each model facility. |
| Latitude / Longitude | Map geometry | **Required to save a map node**; numeric, in geographic ranges, and not both zero. Geometry itself is not part of deterministic model validation. |

It then shows type-specific fields:

| Node type | User-visible parameters | Completeness behavior |
| --- | --- | --- |
| Production Pad | Water Quality, Elevation, Trucking Hourly Cost | Water quality, elevation, and trucking cost are **conditional** on selected modes/routes. Production forecasts are entered in `PadRates`, not on the map node. |
| Completion Pad | Storage Capacity, Operational Cost, Offloading Capacity, Initial Water Quality, Water Quality, Outside System, Elevation, Trucking Hourly Cost | Forecasts and several facility values become **conditional** requirements. Some blanks have defaults. `PadOffloadingCapacity` affects detailed trucking behavior but is not explicitly required by deterministic readiness. |
| Disposal Site | Capacity, Operational Cost, Elevation, Depth, Average Pressure, risk-proximity fields | Capacity and operating cost are **required** for every disposal site. Risk fields are conditional on subsurface modes. |
| Storage Site | Capacity, Water Quality, Elevation | Initial capacity is **required**. Initial level and advanced fields are conditional/defaulted. |
| Treatment Site | Technology, Capacity, Desalination flag, Elevation | Technology/capacity option structures, efficiency, operating cost, and desalination classification are **conditional requirements** when treatment exists. Map Capacity populates `InitialTreatmentCapacity`, which is handled by model construction rather than an explicit deterministic readiness rule. |
| Network Node | Capacity, Elevation | Capacity is a **default/warning** when node-capacity limits are enabled; blank or zero is treated as unrestricted by the capacity screen. |
| External Water Source | Elevation, Water Quality, Cost, Trucking Hourly Cost | Availability and sourcing cost are **conditional requirements** when external sources exist. |
| Reuse Option | Operational Cost, Elevation, Beneficial Reuse Cost, Beneficial Reuse Credit | Forecast minimum/capacity and incoming route are **conditional**; cost/credit blanks default to zero. The displayed Operational Cost is misleading: map synchronization writes canonical `ReuseOperationalCost` only from completion pads, not reuse-option nodes. |

The reuse-cost mismatch can be seen in
[`excel_api.py:639-668`](../backend/app/internal/workbooks/excel_api.py#L639-L668).
The full map-field catalog is in
[`electron/ui/src/util.ts:35-378`](../electron/ui/src/util.ts#L35-L378).

### Pipeline editor fields

| UI field | Requirement |
| --- | --- |
| Pipeline name | **Required** and unique in the editor. |
| Connections | **Required**; at least two compatible facilities. |
| Flow direction | **Required**; must map to an allowed directed arc. |
| Diameter | Needed for diameter-derived capacity and construction options; deterministic validation requires pipeline diameter option data whenever a pipe is enabled. |
| Segment length | Must be numeric and nonnegative in the editor; canonical values are written to `PipelineExpansionDistance`. |

Visual crossings do not create a network junction. Every producing pad with
positive production or flowback must have a directed route to a final destination.
Ordinary storage is not a final destination because terminal storage must be empty;
it needs an onward route. Reachability is checked at
[`scenario_validation.py:237-258`](../backend/app/internal/validation/scenario_validation.py#L237-L258).

## 3. Planning horizon and units

### Planning periods

`TimePeriods` is **required**.

When periods are edited through the UI, they must be:

- Between 1 and 520 entries.
- Nonempty strings no longer than 40 characters.
- Unique after trimming.
- Different from reserved table headings.

Ordered names such as `T01`, `T02`, and `T10` are recommended. Non-alphabetical
order generates a warning because the installed parent model sorts periods for a
storage screen. Changing the horizon updates all forecast tables together; matching
period names retain values and new period cells are blank
([`input_schema.py:82-103`](../backend/app/internal/scenarios/input_schema.py#L82-L103)).

### Units

All ten canonical unit entries are **required** even though the standard sidebar
does not expose `Units` as a normal editable table:

```text
volume
time
decision period
currency
distance
diameter
concentration
pressure
elevation
mass
```

Normal generated defaults are:

```text
volume = bbl
time = day
decision period = week
currency = USD
distance = mile
diameter = inch
concentration = mg/liter
pressure = psi
elevation = foot
mass = g
```

The defaults are defined in
[`input_schema.py:30-32`](../backend/app/internal/scenarios/input_schema.py#L30-L32).
Readiness validates that the strings are present and lexically valid; model
construction still performs the definitive unit interpretation.

## 4. Forecast tables

Every applicable facility/period cell is required unless the listed default applies.

| Table | Applicable rows | Allowed values | Missing behavior |
| --- | --- | --- | --- |
| `PadRates` | Every production pad | Finite number >= 0 | **Required for map scenarios**; Excel blank defaults to 0 with warning. |
| `CompletionsDemand` | Every completions pad | Finite number >= 0 | **Required for map scenarios**; Excel blank defaults to 0 with warning. |
| `FlowbackRates` | Every completions pad | Finite number >= 0 | **Required for map scenarios**; Excel blank defaults to 0 with warning. |
| `ExtWaterSourcingAvailability` | Every external source | Finite number >= 0 | **Conditional required**. |
| `ReuseMinimum` | Every reuse option | Finite number >= 0 | **Conditional required**. |
| `ReuseCapacity` | Every reuse option | `-1` or finite number >= 0 | **Conditional required**. `-1` means unrestricted. |
| `DisposalOperatingCapacity` | Every disposal site | Number from 0 to 1 | Blank defaults to 1 with warning. |

Additional forecast rules:

- Forecast columns may not refer to periods outside `TimePeriods`.
- At least one positive value must exist across `PadRates` and `FlowbackRates`.
- Explicit zero is valid for an inactive facility/period.
- Negative, nonfinite, and nonnumeric values block completeness.

See [`scenario_validation.py:159-177`](../backend/app/internal/validation/scenario_validation.py#L159-L177).

## 5. Facility-dependent capacities and costs

These requirements are activated by facility membership.

| Condition | Table / parameter | Requirement |
| --- | --- | --- |
| Every disposal site | `InitialDisposalCapacity[site]` | **Required**, finite and >= 0. |
| Every disposal site | `DisposalOperationalCost[site]` | **Required**, finite and >= 0. |
| Every storage site | `InitialStorageCapacity[site]` | **Required**, finite and >= 0. |
| Every storage site | `InitialStorageLevel[site]` | Blank defaults to 0 with warning; it may not exceed initial capacity. |
| Every completion pad | `CompletionsPadStorage[pad]` | Blank defaults to 0 with warning. |
| Every network node when node limits are on | `NodeCapacities[node]` | Blank defaults to unrestricted with warning. |
| Every completion pad | `CompletionsPadOutsideSystem[pad]` | Map UI uses 0/1; deterministic validation accepts any number from 0 to 1. Blank defaults to 0 with warning. |
| Every treatment site | `DesalinationSites[site]` | **Required**. Map UI uses 0/1; deterministic validation accepts any number from 0 to 1. |
| Every external source | `ExternalSourcingCost[source]` | **Required**, finite and >= 0. |
| Every completion pad | `ReuseOperationalCost[pad]` | Blank uses the parent-model fallback with warning. |
| Every reuse option | `BeneficialReuseCost[option]` | Blank defaults to 0 with warning. |
| Every reuse option | `BeneficialReuseCredit[option]` | Blank defaults to 0 with warning. |

This catalog is defined at
[`scenario_validation.py:25-47`](../backend/app/internal/validation/scenario_validation.py#L25-L47)
and applied at
[`scenario_validation.py:179-200`](../backend/app/internal/validation/scenario_validation.py#L179-L200).

### Required option sets

When the associated facilities exist, these option sets must be nonempty:

| Facility present | Required set |
| --- | --- |
| Disposal site | `InjectionCapacities` |
| Storage site | `StorageCapacities` |
| Treatment site | `TreatmentCapacities` |
| Treatment site | `TreatmentTechnologies` |

Include a zero-capacity/do-not-build option when construction should not be
available. Project PARETO model construction may impose more detailed increment
and cost-table requirements than the deterministic validator checks.

### Treatment-specific cells

When treatment sites exist:

- Every treatment site/technology pair requires `TreatmentEfficiency` from 0 to 1.
- Every treatment site/technology pair requires nonnegative
  `TreatmentOperationalCost`.
- Every treatment technology requires `DesalinationTechnologies` from 0 to 1.
  The normal map control supplies 0 or 1, but deterministic validation does not
  enforce integrality for workbook/table edits.

## 6. Route and transportation parameters

### Route matrices

The UI exposes these pipeline arc tables:

```text
PNA CNA CCA NNA NCA NKA NRA NSA FCA RCA RNA RSA SCA SNA ROA RKA SOA NOA
```

It exposes these trucking arc tables:

```text
PCT PKT FCT CST CCT CKT RST ROT SOT RKT
```

An empty or zero cell means the route is disabled. An enabled route normally uses
`1`. Treatment-origin route tables may use `2` for residual water. Arc endpoints
must belong to the facility sets encoded by the table name
([`scenario_validation.py:202-216`](../backend/app/internal/validation/scenario_validation.py#L202-L216)).

### Every enabled pipeline

| Parameter | Requirement |
| --- | --- |
| `InitialPipelineCapacity[origin,destination]` | Blank defaults to 0 with warning, meaning new construction is required. |
| `PipelineExpansionDistance[origin,destination]` | **Required**. |
| `PipelineOperationalCost[origin,destination]` | Blank defaults to 0.01 USD/bbl with warning. |

If at least one pipe is enabled:

- `PipelineDiameters` must be nonempty.
- Every diameter requires `PipelineDiameterValues`.
- With `pipeline_capacity="input"`, every diameter requires
  `PipelineCapacityIncrements`.
- With `pipeline_cost="capacity_based"`, every enabled pipe/diameter combination
  requires `PipelineCapexCapacityBased`.

Independently of whether a pipe is enabled, selecting
`pipeline_cost="distance_based"` requires
`PipelineCapexDistanceBased.pipeline_expansion_cost`. This also applies to a
trucking-only network under the default configuration.

The enabled-pipe checks are at
[`scenario_validation.py:217-236`](../backend/app/internal/validation/scenario_validation.py#L217-L236).
The independent distance-based CAPEX rule is at
[`scenario_validation.py:184-187`](../backend/app/internal/validation/scenario_validation.py#L184-L187).

### Every enabled trucking route

| Parameter | Map-origin behavior | Legacy Excel behavior |
| --- | --- | --- |
| `TruckingTime[origin,destination]` | **Required** | Blank defaults to 12 hours with warning. |
| `TruckingHourlyCost[origin]` | **Required** | Blank defaults to 100 times the maximum entered trucking cost, or 15,000 currency/hour, with warning. |

Trucking is treated as unlimited transport by the preliminary network-capacity
screen, so passing that screen does not establish detailed trucking feasibility.

## 7. Economics and general table validity

The following `Economics` fields are always **required**, finite, and nonnegative:

```text
discount_rate
CAPEX_lifetime
```

All non-scalar parameter tables, including optional tables that are present, must:

- Be dictionaries of list-valued columns.
- Have equal column lengths.
- Contain only finite numeric values in nonblank value cells.
- Use known identifiers in recognized index columns.

Saving a table does not prove these conditions; readiness checks them later
([`scenario_validation.py:132-158`](../backend/app/internal/validation/scenario_validation.py#L132-L158)).

## 8. Connected-capacity requirements

For input-based pipeline capacities, readiness runs a directed max-flow screen.
The screen considers:

- Production-pad forecasts.
- Route direction.
- Existing pipeline capacity plus the largest eligible pipe increment.
- Node capacity when enabled.
- Disposal capacity and operating availability.
- Disposal expansion only when initial disposal capacity is explicitly zero.

A detected shortfall is a blocker. Passing is only a necessary condition, not a
proof of feasibility, because the screen deliberately treats trucking and several
complex destinations optimistically and ignores flowback/external supply. See
[`network_capacity.py`](../backend/app/internal/validation/network_capacity.py).

## 9. Optimization parameters requested by the UI

New scenarios receive the following effective base defaults:

| UI setting | Internal key | Default | Allowed UI values | Additional requirements |
| --- | --- | --- | --- | --- |
| Objective Selection | `objective` | `cost` | `cost`, `reuse`, `cost_surrogate`, `subsurface_risk`, `environmental` | `cost_surrogate`, `subsurface_risk`, and `environmental` activate additional tables; `reuse` does not. `cost_surrogate` is shown only when the desalination setting property is truthy. |
| Solver | `solver` | `cbc` | `cbc`, `gurobi_direct` | Gurobi requires a working commercial license. |
| Maximum Runtime | `runtime` | 900 seconds | Numeric field | No deterministic range validation; use a positive value. The value is passed to the solver. |
| Optimality Gap | `optimalityGap` | 0 percent for new scenarios | Numeric field | No deterministic range validation; use a nonnegative percentage. Solve preparation truncates it with `int(value)` and falls back to 0 if conversion fails. |
| Water Quality | `waterQuality` | `false` | `false`, `post_process`, `discrete` | Enabling it activates quality inputs. |
| Hydraulics | `hydraulics` | `false` | `false`, `post_process`, `co_optimize`, `co_optimize_linearized` | Enabling it activates hydraulic inputs; nonlinear `co_optimize` is incompatible with CBC. |

The UI definitions are in
[`Optimization.tsx:122-255`](../electron/ui/src/views/Optimization/Optimization.tsx#L122-L255).

Changing the solver also resets two fields: CBC sets runtime to 900 seconds and
scaling to `true`; Gurobi sets runtime to 180 seconds and scaling to `false`
([`Optimization.tsx:72-105`](../electron/ui/src/views/Optimization/Optimization.tsx#L72-L105)).

### Advanced optimization options

| UI setting | Internal key | Default | Options |
| --- | --- | --- | --- |
| Scale Model | `scale_model` | `true` | `true`, `false` |
| Pipeline Capacity | `pipeline_capacity` | `input` | `input`, `calculated` |
| Pipeline Cost | `pipeline_cost` | `distance_based` | `distance_based`, `capacity_based` |
| Node Capacity | `node_capacity` | `true` | `true`, `false` |
| Infrastructure Timing | `infrastructure_timing` | `false` | `false`, `true` |
| Subsurface Risk | `subsurface_risk` | `false` | off, exclude over/under-pressured wells, calculate risk metrics |
| Removal Efficiency Method | `removal_efficiency_method` | `concentration_based` | `concentration_based`, `load_based` |
| Desalination Surrogate Model | `desalination_model` | `false` | `false`, `mvc`, `md` |
| Deactivate Slacks | `deactivate_slacks` | `true` | `true`, `false` |

Definitions: [`AdvancedOptions.tsx`](../electron/ui/src/views/Optimization/AdvancedOptions.tsx).

The base defaults mean the user does not need to change optimization settings for
a simple CBC run. Changed settings are part of the input revision. Launch repeats
deterministic validation of enum-like model configuration, but does not establish
valid ranges for runtime/gap, solver availability, or the safety of enabling
slacks. Unknown solver names are removed during solve preparation so Project
PARETO can try its fallback solver list
([`strategic_model.py:84-102`](../backend/app/internal/optimization/strategic_model.py#L84-L102)).

## 10. Advanced-mode conditional inputs

The following selections activate additional deterministic checks:

| Selected feature | Additional table(s) that must contain numeric data |
| --- | --- |
| Any hydraulics mode | `Hydraulics`, `Elevation`, `WellPressure`, `InitialPipelineDiameters` |
| Calculated pipeline capacity | `Hydraulics` |
| Any water-quality mode | `PadWaterQuality`; also `StorageInitialWaterQuality` when storage exists and `ExternalWaterQuality` when external sources exist |
| Desalination model or cost-surrogate objective | `DesalinationSurrogate` |
| Environmental objective | `AirEmissionCoefficients`, `TreatmentEmissionCoefficients` |
| Subsurface mode or objective | `SWDDeep`, `SWDAveragePressure`, `SWDProxPAWell`, `SWDProxInactiveWell`, `SWDProxEQ`, `SWDProxFault`, `SWDProxHpOrLpWell`, `SWDRiskFactors` |

These readiness checks generally establish only that each table contains at least
one numeric value. Project PARETO model construction can still require exact
indexing and more complete tables. The checks are implemented at
[`scenario_validation.py:272-295`](../backend/app/internal/validation/scenario_validation.py#L272-L295).

In particular, model-level water-quality inputs can also include
`WaterQualityComponents`, `RemovalEfficiency`, and applicable quality limits.
These are not exhaustively covered by the deterministic advanced-mode check.
Similarly, `DesalinationSurrogate` is required for desalination/cost-surrogate
modes but is commented out of the normal dynamic-table sidebar; it generally must
come from an imported workbook.

Infrastructure timing currently produces a warning rather than a blocker because
the installed model calculates schedules after optimization. Lead-time tables
still need review.

## 11. Parameters exposed in the table sidebar

The generic Data Input table UI exposes the following editable dynamic tables:

### Forecasts and operations

```text
CompletionsDemand
PadRates
FlowbackRates
ExtWaterSourcingAvailability
ReuseMinimum
ReuseCapacity
DisposalOperatingCapacity
```

### Existing facilities and initial state

```text
Elevation
WellPressure
InitialPipelineDiameters
InitialPipelineCapacity
InitialDisposalCapacity
InitialStorageCapacity
InitialTreatmentCapacity
CompletionsPadStorage
PadOffloadingCapacity
NodeCapacities
```

### Operating costs and travel

```text
DisposalOperationalCost
TreatmentOperationalCost
ReuseOperationalCost
PipelineOperationalCost
ExternalSourcingCost
TruckingHourlyCost
TruckingTime
```

### Expansion and construction

```text
DisposalExpansionCost
DisposalCapacityIncrements
StorageExpansionCost
StorageCapacityIncrements
TreatmentExpansionCost
TreatmentCapacityIncrements
PipelineCapexDistanceBased
PipelineExpansionDistance
PipelineCapexCapacityBased
PipelineCapacityIncrements
PipelineDiameterValues
```

### Treatment, quality, economics, emissions, and risk

```text
TreatmentEfficiency
RemovalEfficiency
DesalinationTechnologies
DesalinationSites
BeneficialReuseCost
BeneficialReuseCredit
CompletionsPadOutsideSystem
Hydraulics
Economics
ExternalWaterQuality
PadWaterQuality
StorageInitialWaterQuality
PadStorageInitialWaterQuality
AirEmissionCoefficients
TreatmentEmissionCoefficients
SWDDeep
SWDAveragePressure
SWDProxPAWell
SWDProxInactiveWell
SWDProxEQ
SWDProxFault
SWDProxHpOrLpWell
SWDRiskFactors
```

### Lead times

```text
TreatmentExpansionLeadTime
DisposalExpansionLeadTime
StorageExpansionLeadTime
PipelineExpansionLeadTime_Dist
PipelineExpansionLeadTime_Capac
```

The authoritative frontend list is
[`electron/ui/src/util.ts:500-529`](../electron/ui/src/util.ts#L500-L529).
Presence in this list does **not** mean a table is universally required. Use the
facility-, route-, and setting-dependent rules above.

## 12. Defaults that do not block completeness

The following blanks normally produce warnings rather than errors:

| Input | Effective assumption |
| --- | --- |
| Excel `PadRates`, `CompletionsDemand`, `FlowbackRates` | 0 |
| `DisposalOperatingCapacity` | 1 / 100% available |
| `InitialStorageLevel` | 0 |
| `CompletionsPadStorage` | 0 |
| `NodeCapacities` | Unrestricted |
| `CompletionsPadOutsideSystem` | 0 / inside system |
| `ReuseOperationalCost` | Parent-model fallback cost |
| `BeneficialReuseCost`, `BeneficialReuseCredit` | 0 |
| `InitialPipelineCapacity` | 0; new construction required |
| `PipelineOperationalCost` | 0.01 USD/bbl |
| Legacy Excel `TruckingTime` | 12 hours |
| Legacy Excel `TruckingHourlyCost` | 100 times entered maximum, or 15,000 currency/hour |

These defaults permit an input-complete state, but should be reviewed before
treating results as meaningful engineering or economic estimates.

## 13. Fixed-decision overrides

After a result exists, the UI lets the user fix values for:

```text
Infrastructure build decisions
Piped flow
External sourcing
Trucked flow
Storage inventory
Completion-pad storage inventory
```

Overrides are **optional**, but any supplied override becomes part of the input
revision and must be accepted during model construction. An internally consistent
base scenario can become infeasible after fixed decisions are applied.

## 14. What is not a model-completeness parameter

The following UI controls do not determine model readiness:

- Scenario comparison selections.
- Plot, Sankey, filter, pagination, and display controls.
- Basemap, zoom, and pan settings.
- Uploaded input/output diagram images; these are illustrations, not model
  topology.
- AI connection settings. AI can propose input edits, but an API key is not
  required for validation or optimization.
- Scenario result downloads and report-display choices.

## 15. Known gaps and cautions

1. **The table editor is permissive.** A cell being saveable does not mean it is
   valid or sufficient for a run.
2. **`InitialStorageLevel` is validated but is not in the sidebar's explicit
   dynamic-table list.** It may need to come from the workbook or be created by
   completion autofill.
3. **`DesalinationSurrogate` can be required but is not in the normal dynamic
   table sidebar.** It must generally be supplied by the workbook.
4. **The Reuse Option map field named Operational Cost does not populate the
   canonical `ReuseOperationalCost` model table.** That table is indexed and
   synchronized from completion pads.
5. **`InitialTreatmentCapacity` and `PadOffloadingCapacity` affect the model but
   have no explicit deterministic missing-value rule.** Review them during model
   build and feasibility rather than relying on zero readiness errors.
6. **Readiness is not exhaustive for advanced modes.** Some advanced checks only
   verify that a table contains one numeric value; model construction is stricter.
7. **Expansion validation is narrower than model construction.** Disposal,
   storage, and treatment increment/cost structures should be retained and
   reviewed even when deterministic readiness does not flag every missing cell.
8. **Two map-editor unit labels appear inconsistent with the model:**
   `InitialDisposalCapacity` is displayed as `bbl` although it is flow capacity,
   and `CompletionsPadStorage` is displayed as `bbl/day` although it is storage
   volume ([`electron/ui/src/util.ts:106-184`](../electron/ui/src/util.ts#L106-L184)).
9. **The documented storage operating-cost/revenue request does not correspond to
   dedicated deterministic input tables.** Treat that wording as advisory/stale
   rather than a current completeness rule.
10. **An optimized result with `deactivate_slacks=false` may rely on slack
   variables.** It is a valid result for the relaxed model, not necessarily a
   fully satisfied physical water plan.

## 16. Recommended checklist for a basic complete run

Use this checklist before enabling advanced features. Items marked **blocker**
must pass deterministic readiness; items marked **review** are stronger
recommendations that may otherwise use warning defaults.

- [ ] **Blocker:** Scenario has a nonempty name and a valid input file.
- [ ] **Blocker:** Every model facility is classified and uniquely named.
- [ ] **Blocker:** There is at least one production or completion pad.
- [ ] **Blocker:** There is at least one destination.
- [ ] **Blocker:** Planning periods are present and unique.
- [ ] **Review:** Period names sort chronologically, such as `T01` through `T10`.
- [ ] **Blocker:** All ten unit entries exist.
- [ ] **Blocker:** Every applicable map-origin forecast cell has an explicit
      numeric value; Excel blanks may instead use warning defaults.
- [ ] **Blocker:** Total production plus flowback is positive somewhere in the horizon.
- [ ] **Blocker:** Every enabled route has valid endpoints and direction.
- [ ] **Blocker:** Every producing pad can reach a final destination.
- [ ] **Blocker:** Every enabled pipe has distance and required
      capacity/construction option data.
- [ ] **Review:** Pipeline capacity and operating cost are explicit rather than
      relying on zero/0.01 warning defaults.
- [ ] **Blocker:** Pipeline diameter values and applicable capacity increments exist.
- [ ] **Blocker:** Applicable facility capacities and costs without defaults are present.
- [ ] **Blocker:** `discount_rate` and `CAPEX_lifetime` are present.
- [ ] **Blocker:** Distance-based pipeline CAPEX is present when that mode is used.
- [ ] **Review:** Applicable zero-size options, expansion increments, and costs
      remain available; deterministic validation does not check every cell.
- [ ] **Blocker:** The necessary connected-capacity screen can carry each period's production.
- [ ] **Review:** Base settings use cost objective, CBC, input pipeline capacities,
      distance-based pipeline cost, and advanced modes off.
- [ ] **Blocker:** **Complete Scenario Inputs** reports zero errors.
- [ ] **Model build:** **Validate Scenario** reports that the model builds.
- [ ] **Recommended evidence:** **Check feasibility** finds a feasible zero-slack plan.
- [ ] **Review:** Warning/default assumptions have been checked for realism.

## 17. Maintained minimal example

The backend's small acceptance fixture starts from the generated workbook template,
retains its units, economics, CAPEX, and disposal-option defaults, and then applies
these key distinguishing values:

```text
Facilities: P1 production pad, N1 network node, K1 disposal site
Periods: T01, T02
PadRates: P1 = 100 in both periods
Routes: P1 -> N1 -> K1
Pipe capacities: 100 on both pipes
Node capacity: 100
Disposal capacity: 100
Disposal operating cost: 1
Pipeline diameter option: D0 with value/increment 0 for no new construction
Solver: CBC
Pipeline cost: distance based
Water quality and hydraulics: off
```

See
[`backend/tests/scenario_fixtures.py:42-64`](../backend/tests/scenario_fixtures.py#L42-L64)
and the user walkthrough in [`scenario-completion.md`](scenario-completion.md).

## Primary references

- Backend deterministic validation:
  [`backend/app/internal/validation/scenario_validation.py`](../backend/app/internal/validation/scenario_validation.py)
- Planning horizon and canonical sets:
  [`backend/app/internal/scenarios/input_schema.py`](../backend/app/internal/scenarios/input_schema.py)
- Connected-capacity screen:
  [`backend/app/internal/validation/network_capacity.py`](../backend/app/internal/validation/network_capacity.py)
- Run and advancement gates:
  [`backend/app/routers/scenarios.py`](../backend/app/routers/scenarios.py)
- Frontend table inventory:
  [`electron/ui/src/util.ts`](../electron/ui/src/util.ts)
- Optimization controls:
  [`electron/ui/src/views/Optimization/Optimization.tsx`](../electron/ui/src/views/Optimization/Optimization.tsx)
- Advanced controls:
  [`electron/ui/src/views/Optimization/AdvancedOptions.tsx`](../electron/ui/src/views/Optimization/AdvancedOptions.tsx)
- User workflow:
  [`docs/scenario-completion.md`](scenario-completion.md)
- Validation semantics:
  [`docs/scenario-validation.md`](scenario-validation.md)

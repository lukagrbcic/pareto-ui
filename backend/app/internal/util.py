import json
import math
import time
import functools

import logging

from pareto.strategic_water_management.strategic_produced_water_optimization import (
    Objectives,
    PipelineCost,
    PipelineCapacity,
    Hydraulics,
    WaterQuality,
    RemovalEfficiencyMethod,
    InfrastructureTiming,
    SubsurfaceRisk,
    DesalinationModel,
    CONFIG,
)


_log = logging.getLogger(__name__)
EARTH_RADIUS_MILES = 3958.7613

DEFAULT_UNITS = {
    "volume": "bbl",
    "distance":	"mile",
    "diameter":	"inch",
    "concentration": "mg/liter",
    "currency":	"USD",
    "time":	"day",
    "pressure":	"psi",
    "elevation": "foot",
    "decision_period": "week",
    "mass": "g"
}

ARC_TABLES = {
    "PNA": "ProductionPads",
    "CNA": "CompletionsPads",
    "CCA": "CompletionsPads",
    "NNA": "NetworkNodes",
    "NCA": "NetworkNodes",
    "NKA": "NetworkNodes",
    "NRA": "NetworkNodes",
    "NSA": "NetworkNodes",
    "FCA": "ExternalWaterSources",
    "RCA": "TreatmentSites",
    "RNA": "TreatmentSites",
    "RSA": "TreatmentSites",
    "SCA": "StorageSites",
    "SNA": "StorageSites",
    "ROA": "TreatmentSites",
    "RKA": "TreatmentSites",
    "SOA": "StorageSites",
    "NOA": "NetworkNodes",
    "PCT": "ProductionPads",
    "PKT": "ProductionPads",
    "FCT": "ExternalWaterSources",
    "CST": "CompletionsPads",
    "CCT": "CompletionsPads",
    "CKT": "CompletionsPads",
    "RST": "TreatmentSites",
    "ROT": "TreatmentSites",
    "SOT": "StorageSites",
    "RKT": "TreatmentSites",
}


def time_it(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start_time = time.perf_counter()
        result = func(*args, **kwargs)
        end_time = time.perf_counter()
        elapsed_time = end_time - start_time
        _log.info(f"Function '{func.__name__}' executed in {elapsed_time:.2f} seconds")
        return result

    return wrapper

def calculate_distance(coord1, coord2):
        # print(f'calculating distance from {coord1} to {coord2}')
        distance = math.sqrt(((float(coord1[0]) - float(coord2[0]))**2) + ((float(coord1[1]) - float(coord2[1]))**2))
        return distance

def classifyNode(data, default_node):
    if default_node == "ProductionPad":
        data["node_type"] = "ProductionPad"
    elif default_node == "CompletionsPad":
        data["node_type"] = "CompletionsPad"
    elif default_node == "NetworkNode":
        data["node_type"] = "NetworkNode"
    elif default_node == "DisposalSite":
        data["node_type"] = "DisposalSite"
    elif default_node == "TreatmentSite":
        data["node_type"] = "TreatmentSite"
        # storage_site_key = key.replace('R','S').replace('r','S')
        # storage_sites[storage_site_key] = data
        # connections["all_connections"][key] = [storage_site_key]
        # connections["all_connections"][storage_site_key] = [key]
    elif default_node == "StorageSite":
        data["node_type"] = "StorageSite"
    elif default_node == "NetworkNode":
        data["node_type"] = "NetworkNode"
    elif default_node == "ReuseOption":
        data["node_type"] = "ReuseOption"
    else:
        data["node_type"] = "NetworkNode"

def _to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def calculate_distance_from_coordinates(start_coords, end_coords):
    """
    Great-circle distance (miles) between two [lon, lat] coordinates.
    Mirrors frontend `calculateDistanceFromCoordinates`.
    """
    lon1 = _to_float(start_coords[0]) if isinstance(start_coords, (list, tuple)) and len(start_coords) >= 2 else None
    lat1 = _to_float(start_coords[1]) if isinstance(start_coords, (list, tuple)) and len(start_coords) >= 2 else None
    lon2 = _to_float(end_coords[0]) if isinstance(end_coords, (list, tuple)) and len(end_coords) >= 2 else None
    lat2 = _to_float(end_coords[1]) if isinstance(end_coords, (list, tuple)) and len(end_coords) >= 2 else None

    if None in (lon1, lat1, lon2, lat2):
        return 0

    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)

    a = (
        math.sin(d_lat / 2) * math.sin(d_lat / 2) +
        math.cos(lat1_rad) * math.cos(lat2_rad) *
        math.sin(d_lon / 2) * math.sin(d_lon / 2)
    )
    # Guard against floating-point drift outside [0, 1].
    a = max(0, min(1, a))
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_MILES * c

def calculatePipelineLenghts(arcs):
    """
    For each arc, derive segment lengths in miles such that:
      lengths[i] is distance between nodes[i] and nodes[i + 1].
    """
    if not isinstance(arcs, dict):
        return arcs

    for arc in arcs.values():
        nodes = arc.get("nodes", [])
        if not isinstance(nodes, list) or len(nodes) < 2:
            arc["lengths"] = []
            continue

        lengths = []
        for idx in range(len(nodes) - 1):
            start_coords = (nodes[idx] or {}).get("coordinates", [])
            end_coords = (nodes[idx + 1] or {}).get("coordinates", [])
            lengths.append(calculate_distance_from_coordinates(start_coords, end_coords))
        arc["lengths"] = lengths

    return arcs

def determineArcsAndConnections(data):
    """Map line vertices to connections, retaining bends without self-connections."""
    arcs = data.get("arcs", {})
    all_nodes = data.get("all_nodes", {})
    connections = {"all_connections": {}}
    data["connections"] = connections
    for arc in arcs.values():
        # Existing arcs already contain their directions and geometry when an
        # additional map is imported. Only derive newly imported polylines.
        if "coordinates" not in arc:
            for node in arc.get("nodes", []):
                outgoing = connections["all_connections"].setdefault(node["name"], [])
                outgoing.extend(n for n in node.get("outgoing_nodes", []) if n not in outgoing)
            continue
        coordinates = arc.pop("coordinates")
        selected = []
        for idx, coords in enumerate(coordinates):
            closest = min(all_nodes, key=lambda name: calculate_distance(coords, all_nodes[name]["coordinates"]), default=None)
            if closest is not None and (not selected or selected[-1][0] != closest):
                selected.append((closest, idx))
        if len(selected) > 1:
            selected[-1] = (selected[-1][0], len(coordinates) - 1)
        nodes = [{"name": name, "coordinates": coordinates[idx], "outgoing_nodes": []} for name, idx in selected]
        lengths = []
        for idx, node in enumerate(nodes):
            outgoing = connections["all_connections"].setdefault(node["name"], [])
            if idx + 1 >= len(nodes):
                continue
            target = nodes[idx + 1]["name"]
            node["outgoing_nodes"] = [target]
            if target not in outgoing:
                outgoing.append(target)
            segment = coordinates[selected[idx][1]:selected[idx + 1][1] + 1]
            node["segment_coordinates"] = segment
            lengths.append(sum(calculate_distance_from_coordinates(a, b) for a, b in zip(segment, segment[1:])))
        arc["nodes"] = nodes
        arc["lengths"] = lengths
    return data

## TODO: we must handle elevation
def build_map_data_from_json(data_input):
    """
    Build map_data from JSON data_input (df_sets/df_parameters), preserving
    coordinates from any existing map_data when possible.
    """
    df_sets = data_input.get("df_sets", {}) or {}
    df_parameters = data_input.get("df_parameters", {}) or {}
    existing_map_data = data_input.get("map_data", {}) or {}
    existing_all_nodes = existing_map_data.get("all_nodes", {}) or {}

    def normalize_coords(coords):
        if not isinstance(coords, (list, tuple)) or len(coords) < 2:
            return [0, 0]
        return [coords[0], coords[1]]

    node_type_by_set = {
        "ProductionPads": "ProductionPad",
        "CompletionsPads": "CompletionsPad",
        "NetworkNodes": "NetworkNode",
        "SWDSites": "DisposalSite",
        "TreatmentSites": "TreatmentSite",
        "StorageSites": "StorageSite",
        "ReuseOptions": "ReuseOption",
        "ExternalWaterSources": "ExternalWaterSource",
        "FreshwaterSources": "ExternalWaterSource",
    }

    all_nodes = {}
    for set_name, node_type in node_type_by_set.items():
        node_list = df_sets.get(set_name)
        if not node_list:
            continue
        for node_name in node_list:
            existing_node = existing_all_nodes.get(node_name, {})
            coords = normalize_coords(existing_node.get("coordinates"))
            node_data = {
                **existing_node,
                "name": node_name,
                "node_type": existing_node.get("nodeType", node_type),
                "nodeType": existing_node.get("nodeType", node_type),
                "coordinates": coords,
            }
            all_nodes[node_name] = node_data

    arc_table_sets = {
        "PNA": ("ProductionPads", "NetworkNodes"),
        "CNA": ("CompletionsPads", "NetworkNodes"),
        "CCA": ("CompletionsPads", "CompletionsPads"),
        "NNA": ("NetworkNodes", "NetworkNodes"),
        "NCA": ("NetworkNodes", "CompletionsPads"),
        "NKA": ("NetworkNodes", "SWDSites"),
        "NRA": ("NetworkNodes", "TreatmentSites"),
        "NSA": ("NetworkNodes", "StorageSites"),
        "NOA": ("NetworkNodes", "ReuseOptions"),
        "SNA": ("StorageSites", "NetworkNodes"),
        "SOA": ("StorageSites", "ReuseOptions"),
        "FCA": ("ExternalWaterSources", "CompletionsPads"),
        "RCA": ("TreatmentSites", "CompletionsPads"),
        "RSA": ("TreatmentSites", "StorageSites"),
        "SCA": ("StorageSites", "CompletionsPads"),
        "RNA": ("TreatmentSites", "NetworkNodes"),
        "ROA": ("TreatmentSites", "ReuseOptions"),
        "RKA": ("TreatmentSites", "SWDSites"),
        "PCT": ("ProductionPads", "CompletionsPads"),
        "FCT": ("ExternalWaterSources", "CompletionsPads"),
        "PKT": ("ProductionPads", "SWDSites"),
        "CKT": ("CompletionsPads", "SWDSites"),
        "CCT": ("CompletionsPads", "CompletionsPads"),
        "CST": ("CompletionsPads", "StorageSites"),
        "RST": ("TreatmentSites", "StorageSites"),
        "ROT": ("TreatmentSites", "ReuseOptions"),
        "SOT": ("StorageSites", "ReuseOptions"),
        "RKT": ("TreatmentSites", "SWDSites"),
    }

    def is_connected(value):
        if value in (None, "", False):
            return False
        try:
            return float(value) != 0
        except (TypeError, ValueError):
            return True

    connections = {"all_connections": {}}
    edge_set = set()

    def add_connection(node_a, node_b):
        connections["all_connections"].setdefault(node_a, [])
        connections["all_connections"].setdefault(node_b, [])
        if node_b not in connections["all_connections"][node_a]:
            connections["all_connections"][node_a].append(node_b)
        if node_a not in connections["all_connections"][node_b]:
            connections["all_connections"][node_b].append(node_a)

    for table_key, (row_set, col_set) in arc_table_sets.items():
        table_data = df_parameters.get(table_key)
        if not isinstance(table_data, dict):
            continue
        row_key = row_set if row_set in table_data else None
        if row_key is None and row_set == "ExternalWaterSources" and "FreshwaterSources" in table_data:
            row_key = "FreshwaterSources"
        if row_key is None:
            continue

        row_nodes = table_data.get(row_key) or []
        row_allowed = set(df_sets.get(row_key, []) or [])
        col_allowed = set(df_sets.get(col_set, []) or [])
        if not row_nodes:
            continue

        for col_node, col_values in table_data.items():
            if col_node == row_key:
                continue
            if col_node not in col_allowed or not isinstance(col_values, list):
                continue
            for idx, value in enumerate(col_values):
                if idx >= len(row_nodes):
                    break
                row_node = row_nodes[idx]
                if row_node not in row_allowed:
                    continue
                if not is_connected(value):
                    continue
                edge_key = tuple(sorted((row_node, col_node)))
                edge_set.add(edge_key)
                add_connection(row_node, col_node)

    existing_arcs = existing_map_data.get("arcs", {}) or {}
    existing_arc_by_edge = {}
    for arc in existing_arcs.values():
        nodes = arc.get("nodes") or []
        if len(nodes) < 2:
            continue
        start = nodes[0].get("name")
        end = nodes[-1].get("name")
        if start and end:
            existing_arc_by_edge[tuple(sorted((start, end)))] = arc

    arcs = {}
    for edge_key in edge_set:
        node_a, node_b = edge_key
        existing_arc = existing_arc_by_edge.get(edge_key)
        if existing_arc:
            arc = existing_arc.copy()
            arc["nodes"] = [n.copy() for n in existing_arc.get("nodes", [])]
            arc_name = arc.get("name") or f"{node_a}_{node_b}"
        else:
            coords_a = all_nodes.get(node_a, {}).get("coordinates", [0, 0])
            coords_b = all_nodes.get(node_b, {}).get("coordinates", [0, 0])
            arc_name = f"{node_a}_{node_b}"
            arc = {
                "name": arc_name,
                "node_type": "path",
                "node_list": [node_a, node_b],
                "nodes": [
                    {
                        "name": node_a,
                        "coordinates": coords_a,
                        "outgoing_nodes": [node_b],
                    },
                    {
                        "name": node_b,
                        "coordinates": coords_b,
                        "outgoing_nodes": [node_a],
                    },
                ],
            }
        while arc_name in arcs:
            arc_name = f"{arc_name}_dup"
            arc["name"] = arc_name
        arcs[arc_name] = arc

    map_data = {
        **existing_map_data,
        "all_nodes": all_nodes,
        # "arcs": arcs,
        "connections": connections,
        "defaultNode": existing_map_data.get("defaultNode", "NetworkNode"),
        "polygons": existing_map_data.get("polygons", {}),
        "other_nodes": existing_map_data.get("other_nodes", {}),
    }

    for set_name, node_type in node_type_by_set.items():
        node_list = df_sets.get(set_name)
        if not node_list:
            continue
        nodes = {}
        for node_name in node_list:
            node_entry = all_nodes.get(node_name)
            if not node_entry:
                continue
            nodes[node_name] = {
                "Name": node_name,
                "coordinates": node_entry.get("coordinates", [0, 0]),
                "node_type": node_type,
            }
        map_data[set_name] = nodes

    return map_data

def _units_defaults_block():
    """Units and blank-cell conventions for the scenario inputs.

    Tells the model which display units the app uses (DEFAULT_UNITS) and that
    blank cells mean "never filled" — not zero — so it must not fill blanks
    with 0 unless the documented default for that table is actually 0.
    """
    return (
        "Units and defaults: the scenario's display units are "
        f"{json.dumps(DEFAULT_UNITS)}. Blank cells mean an input was never filled; they are not zeros, "
        "so never fill a blank with 0 unless the documented default for that table is actually 0. "
        "When you add or change values, state the units you assumed in updateNotes.\n"
    )


def _model_requirements_block(optimization_settings):
    """The effective model parameters implied by the user's optimization settings.

    Fills must be tailored to the configured model: features that are enabled
    (water quality, hydraulics, desalination, ...) make their input tables
    required, and objective/solver choices shape what values make sense.
    """
    if not optimization_settings:
        return ""
    try:
        # Reuse the same settings resolution the optimizer uses, so the model
        # sees exactly the configuration that will be built.
        model_parameters = prepare_config({"optimization": optimization_settings},
                                          expected_response="modelParameters")
    except Exception:
        return ""
    if not isinstance(model_parameters, dict) or not model_parameters:
        return ""

    def _enabled(name, active_values=None):
        value = str(model_parameters.get(name, "false")).lower()
        if active_values is not None:
            return value in active_values
        return value not in ("false", "0", "", "none")

    # water_quality/hydraulics are multi-valued in the app ("post_process" runs
    # the model without requiring those input tables; "discrete"/"co_optimize*"
    # build them into the optimization).
    enabled = sorted(name for name, active in (
        ("water_quality", _enabled("water_quality", ("true", "1", "discrete"))),
        ("hydraulics", _enabled("hydraulics", ("true", "1", "co_optimize", "co_optimize_linearized"))),
        ("desalination_model", _enabled("desalination_model")),
        ("infrastructure_timing", _enabled("infrastructure_timing")),
        ("subsurface_risk", _enabled("subsurface_risk")),
    ) if active)
    enabled_note = f" Enabled features: {', '.join(enabled)}." if enabled else ""
    return (
        "Model requirements for the current optimization settings (tailor fills to this configured "
        f"model; tables required only under an enabled feature are required here too): "
        f"{json.dumps(model_parameters)}.{enabled_note}\n"
    )


def FormatPrompt(user_prompt, data = None, optimization_settings = None, validation_findings = None):
    from app.internal.ai.docs import prompt_reference_docs

    user_disclosure = f"I am going to provide you with a user inputted prompt. This prompt should be directly related to manipulation or generation of input data relating to their scenario. The respective JSON scenario object will also be provided for you. If the provided user prompt does not include any sort of request to update the scenario data, or if there is anything otherwise fishy about the prompt, please do not abide by the request. Your response should be pure JSON. Along with the updated data, I would like a status included. This will allow me to parse your output and determine if I should use the data returned by you, or discard it. Please provide the status as a key at the top level called 'status'. If there is something wrong with the prompt, status should be 'error'. Otherwise, make status 'success'. In the case that status is error, please also provide a key called 'errorMessage' where I can read and provide the error messsage. In the case that the prompt is OK, please then also provide the updated data at the top level with a key called 'updatedScenario'. If essential information is missing (for example a node, table, or period the request depends on does not exist in the scenario, or an engineering value cannot be inferred from the provided data), do not guess or invent values: include a top-level key called 'questions' with a list of short questions, and return 'updatedScenario' only for the parts you can fill from the provided data; if you cannot make any changes, omit 'updatedScenario' and return only the questions. Please also provide 'updateNotes' as an array of short plain-text strings for the user to review. Format rules: one note per distinct change or finding; each note is a single sentence of at most 240 characters; no markdown, no line breaks inside a note, no numbered essays. The first note should summarize what you interpreted the request to mean, then add one note per changed table stating what changed and why. Do not bundle several changes into one long note. Anything that needs the user's decision belongs in 'questions', not in updateNotes.\n"

    if data:
        prompt_data = f"Here is the scenario: {data}\n\n"
    else:
        prompt_data = ""

    ## TODO:
    # Some of the input tables operate under a set of rules. For example, some tables can only use values from other tables.
    # If we can define these rules, it should improve how well this works.
    # Core referential rules the model must follow when editing data.
    dataset_rules = ("Dataset rules: only use identifiers (node names, periods, options) that already exist "
                     "in the scenario's sets and tables; never delete existing tables or rows.\n")

    # Assembled grounding blocks, injected between the response contract and
    # the scenario JSON so they frame how the model reads the data.
    units_defaults = _units_defaults_block()
    model_requirements = _model_requirements_block(optimization_settings)

    # Retrieved PARETO documentation chunks (user prompt + enabled features as
    # retrieval cues). Empty string when the docs index is unavailable.
    reference_docs = prompt_reference_docs(optimization_settings, user_prompt)
    reference = f"{reference_docs}\n\n" if reference_docs else ""

    # Live validation findings (when handed over via "Fix with AI" or auto-
    # attached from the last run) steer the fill toward the actual problems.
    validation = ""
    if validation_findings:
        validation = f"Here are the current validation findings for this scenario. Prioritize resolving these with targeted data changes:\n{validation_findings}\n\n"

    prompt = f"{user_disclosure}{reference}{model_requirements}{dataset_rules}{units_defaults}{validation}{prompt_data}Here is the prompt:\n{user_prompt}"

    return prompt

def FormatOptimizationDiagnosisPrompt(error_message, scenario = None, diagnosis_context = None, optimization_settings = None):
    from app.internal.ai.docs import diagnosis_reference_docs

    user_disclosure = (
        "You are diagnosing a failed PARETO optimization run inside a desktop application. "
        "The optimization model comes from the project-pareto Python package and uses the pyomo Python package underneath. "
        "Those packages are installed in the current runtime environment, so error messages may reference PARETO, Pyomo, model construction, solver invocation, infeasibility, or related optimization internals. "
        "The user can modify scenario input data and optimization settings directly in the app. "
        "The user cannot edit units in the app; units are controlled by the application and should be assumed fixed and internally compatible when the scenario data and optimization settings are valid. "
        "Your job is to explain the likely issue and propose realistic next steps that the user can actually attempt "
        "without editing code. Avoid suggesting backend or source-code changes unless the failure is clearly an environment "
        "or installation problem, and if you do mention one, mark it as admin-only. Do not suggest changing units or unit systems. "
        "Respond with pure JSON only. Include a top-level 'status' key with value 'success' or 'error'. "
        "For success, include: "
        "'summary' (string), "
        "'likelyCauses' (array of short strings), "
        "'nextSteps' (array of objects with keys 'title', 'instruction', optional 'reason', optional 'appArea'), "
        "and optional 'cautionNotes' (array of short strings). "
        "The next steps should be ordered from most practical to least practical, and should focus on edits to input data, "
        "network assumptions, bounds, capacities, demand/supply values, treatment/disposal/reuse settings, overrides, and optimization settings like runtime, optimality gap, solver-adjacent settings already exposed in the app. "
        "Use the constraint residuals and sampled input tables as clues for practical table-level changes. "
        "Respect the supplied diagnostic limitations: current values may be initial values, and residuals do not prove which constraints cause infeasibility. "
        "Distinguish observations from hypotheses, acknowledge missing evidence, and do not invent unseen input values or promise feasibility. "
        "If you cannot diagnose from the provided information, return status 'error' and include 'errorMessage'.\n"
    )

    scenario_data = f"Scenario context:\n{scenario}\n\n" if scenario else ""
    diagnosis_data = f"Diagnosis context:\n{diagnosis_context}\n\n" if diagnosis_context else ""
    # Retrieved PARETO docs, cued by the failure message itself (plus enabled
    # features) so solver errors get grounded explanations. Empty string
    # without the docs index.
    reference_docs = diagnosis_reference_docs(optimization_settings, error_message)
    reference = f"{reference_docs}\n\n" if reference_docs else ""
    return f"{user_disclosure}{reference}{scenario_data}{diagnosis_data}Optimization failure message:\n{error_message}"

def summarize_long_text(text, start_chars=6000, end_chars=4000):
    if text is None:
        return ""

    text = str(text)
    max_length = start_chars + end_chars
    if len(text) <= max_length:
        return text

    omitted_chars = len(text) - max_length
    return (
        f"{text[:start_chars]}\n\n"
        f"... [{omitted_chars} characters omitted for brevity] ...\n\n"
        f"{text[-end_chars:]}"
    )

def prepare_config(scenario, expected_response="conf"):
    _log.info(f"preparing config: ")
    optimizationSettings = scenario.get('optimization') or {}
    modelParameters = {
        "objective": optimizationSettings.get('objective',"cost"),
        "runtime": optimizationSettings.get('runtime',900),
        "pipeline_cost": optimizationSettings.get("pipeline_cost", "distance_based"),
        "pipeline_capacity": optimizationSettings.get("pipeline_capacity", "input"),
        "node_capacity": optimizationSettings.get("node_capacity", True),
        "water_quality": optimizationSettings.get("waterQuality", "false"),
        "solver": optimizationSettings.get('solver',None),
        "build_units": optimizationSettings.get('build_units',"user_units"),
        "optimalityGap": optimizationSettings.get("optimalityGap", 5),
        "scale_model": optimizationSettings.get("scale_model", True),
        "hydraulics": optimizationSettings.get('hydraulics',"false"),
        "removal_efficiency_method": optimizationSettings.get('removal_efficiency_method',"concentration_based"),
        "desalination_model": optimizationSettings.get("desalination_model", "false"),
        "infrastructure_timing": optimizationSettings.get("infrastructure_timing", "false"),
        "subsurface_risk": optimizationSettings.get("subsurface_risk", "false"),
        "deactivate_slacks": optimizationSettings.get("deactivate_slacks", True),
    }

    default = {
        "objective": modelParameters["objective"],
        "pipeline_cost": modelParameters["pipeline_cost"],
        "pipeline_capacity": modelParameters["pipeline_capacity"],
        "hydraulics": modelParameters["hydraulics"],
        "node_capacity": modelParameters["node_capacity"],
        "water_quality": modelParameters["water_quality"],
        "removal_efficiency_method": modelParameters["removal_efficiency_method"],
        "infrastructure_timing": modelParameters["infrastructure_timing"],
        "subsurface_risk": modelParameters["subsurface_risk"],
        "desalination_model": modelParameters["desalination_model"],
    }

    if expected_response == "conf":
        return CONFIG(default)
    elif expected_response == "modelParameters":
        return modelParameters
    else:
        return CONFIG(default)

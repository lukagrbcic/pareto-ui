"""Preview and apply one explicit value to currently flagged numeric inputs."""
from collections import Counter
from copy import deepcopy
from functools import lru_cache
import math

from app.internal.scenarios.input_schema import FORECASTS, NODE_SETS, OPTION_SETS, dimension_count, input_revision
from app.internal.validation.scenario_validation import REQUIREMENTS, SECTION_NAMES, numeric, validate_inputs


_INDEX_HEADERS = {s.lower() for s in (*NODE_SETS, *OPTION_SETS, 'TimePeriods')} | {
    'nodes', 'pads', 'index', 'time', 'quantity', 'freshwatersources'
}


def _is_index_header(header):
    return str(header).split('.')[0].lower() in _INDEX_HEADERS


@lru_cache(maxsize=1)
def template_headers():
    from openpyxl import load_workbook
    from app.internal.workbooks.excel_api import DEFAULT_TEMPLATE_LOCATION
    workbook = load_workbook(DEFAULT_TEMPLATE_LOCATION, read_only=True, data_only=True)
    try:
        result = {}
        for sheet in workbook:
            headers = [str(cell.value) for cell in next(sheet.iter_rows(min_row=2, max_row=2)) if cell.value is not None]
            seen = Counter()
            result[sheet.title] = []
            for header in headers:
                result[sheet.title].append(f'{header}.{seen[header]}' if seen[header] else header)
                seen[header] += 1
        return result
    finally:
        workbook.close()


def set_cell(tables, table, keys, value, periods):
    """Match scalar and matrix indices; create missing rows without guessing names."""
    columns = tables.get(table)
    if not columns:
        headers = ([FORECASTS[table][0], *periods] if table in FORECASTS else template_headers().get(table, []))
        # Older bundled workbooks omit some supported scalar inputs, including
        # InitialStorageLevel. The requirement defines their index explicitly.
        if not headers:
            requirement = next((item for item in REQUIREMENTS if item.table == table), None)
            if requirement:
                headers = [requirement.node_set, 'VALUE']
            elif len(keys) == 1:
                headers = ['INDEX', 'VALUE']
        # Empty matrix templates contain only their index headings.
        if headers and headers[-1].lower() != 'value' and len(headers) < len(keys):
            headers = [*headers, keys[-1]]
        columns = {header: [] for header in headers}
    if (isinstance(columns, dict) and columns and
            all(isinstance(v, list) for v in columns.values()) and
            len({len(v) for v in columns.values()}) == 1):
        existing_headers = list(columns)
        if (existing_headers[-1].lower() != 'value' and
                all(_is_index_header(h) for h in existing_headers) and
                len(existing_headers) == len(keys) - 1 and
                keys[-1] not in columns):
            row_count = len(columns[existing_headers[0]])
            columns = {**columns, keys[-1]: [''] * row_count}
    if (not isinstance(columns, dict) or len(columns) < 2 or
            any(not isinstance(v, list) for v in columns.values()) or
            len({len(v) for v in columns.values()}) != 1):
        raise ValueError(f'{table}: repair the table columns before filling values.')
    headers = list(columns)
    count = dimension_count(headers)
    scalar = len(headers) == count + 1 and headers[-1].lower() == 'value'
    if len(keys) != count + (0 if scalar else 1):
        raise ValueError(f'{table}: repair the table headings before filling values.')
    column = headers[-1] if scalar else keys[-1]
    if column in headers[:count]:
        raise ValueError(f'{table}: a value column conflicts with an index heading.')
    size = len(columns[headers[0]])
    matches = [i for i in range(size) if tuple(columns[h][i] for h in headers[:count]) == keys[:count]]
    if len(matches) > 1:
        raise ValueError(f'{table}: remove duplicate rows for {" / ".join(keys[:count])} before filling values.')
    if column not in columns:
        columns[column] = [''] * size
    index = matches[0] if matches else size
    if not matches:
        for h in columns:
            columns[h].append(keys[headers.index(h)] if h in headers[:count] else '')
    columns[column][index] = value
    tables[table] = columns


def prepare_fill(scenario, section, value):
    """Compute preview and apply from the same complete set of eligible cells.

    Validation caps visible issues at 250, but collects fill targets separately.
    The route checks the revision before recomputing this operation, so accepting
    a preview cannot apply a value to inputs changed since that preview.
    """
    if section not in SECTION_NAMES:
        raise ValueError('Choose a completion section to fill.')
    number = numeric(value)
    if number is None or isinstance(value, bool):
        raise ValueError('Enter a finite numeric value.')
    targets = {}
    result = validate_inputs(scenario, fill_targets=targets)
    selected = [t for t in targets.values() if t['section'] == section]
    for target in selected:
        if (not target['minimum'] <= number <= target['maximum'] or
                target['table'] == 'ReuseCapacity' and -1 < number < 0):
            bound = (f"at least {target['minimum']}" if target['maximum'] == math.inf else
                     f"between {target['minimum']} and {target['maximum']}")
            if target['table'] == 'ReuseCapacity':
                bound = 'nonnegative, or -1 for unrestricted capacity'
            raise ValueError(f"{target['table']} requires a value {bound}. Fill tables individually if they need different values.")
    updated = deepcopy(scenario)
    tables = updated['data_input'].setdefault('df_parameters', {})
    for target in selected:
        set_cell(tables, target['table'], target['keys'], number, result['periods'])
    counts = Counter(t['table'] for t in selected)
    units = scenario['data_input'].get('display_units', {})
    return updated, {
        'revision': input_revision(scenario), 'value': number, 'cell_count': len(selected),
        'tables': [{'name': name, 'cell_count': count, 'unit': units.get(name, '')} for name, count in sorted(counts.items())],
    }


UNIT_INTERVAL_TABLES = frozenset({
    'DisposalOperatingCapacity',
    'TreatmentEfficiency',
    'DesalinationTechnologies',
    'DesalinationSites',
    'CompletionsPadOutsideSystem',
})


def _cell_bounds(table, keys, targets):
    if (table, keys) in targets:
        target = targets[(table, keys)]
        return target['minimum'], target['maximum']
    requirement = next((item for item in REQUIREMENTS if item.table == table), None)
    if requirement is not None:
        return requirement.minimum, requirement.maximum
    if table == 'ReuseCapacity':
        return -1, math.inf
    if table in UNIT_INTERVAL_TABLES:
        return 0, 1
    return 0, math.inf


def apply_cell_edits(scenario, edits):
    """Validate and apply individual cell edits from Complete Scenario Inputs."""
    if not isinstance(edits, list) or not edits:
        raise ValueError('Provide at least one cell edit to save.')
    targets = {}
    result = validate_inputs(scenario, fill_targets=targets)
    normalized = []
    for item in edits:
        if not isinstance(item, dict):
            raise ValueError('Each cell edit must be an object with table, keys, and value.')
        table = item.get('table')
        raw_keys = item.get('keys')
        raw_value = item.get('value')
        if not isinstance(table, str) or not table.strip():
            raise ValueError('Each cell edit requires a table name.')
        if (not isinstance(raw_keys, (list, tuple)) or not raw_keys or
                any(not isinstance(k, str) or not k.strip() for k in raw_keys)):
            raise ValueError(f'{table}: each cell edit requires nonempty row/column keys.')
        keys = tuple(k.strip() for k in raw_keys)
        number = numeric(raw_value)
        if number is None or isinstance(raw_value, bool):
            raise ValueError(f"{table} ({' / '.join(keys)}): enter a finite numeric value.")
        minimum, maximum = _cell_bounds(table, keys, targets)
        if (not minimum <= number <= maximum or
                (table == 'ReuseCapacity' and -1 < number < 0)):
            bound = (f'at least {minimum:g}' if maximum == math.inf else
                     f'between {minimum:g} and {maximum:g}')
            if table == 'ReuseCapacity':
                bound = 'nonnegative, or -1 for unrestricted capacity'
            raise ValueError(f"{table} ({' / '.join(keys)}) requires a value {bound}.")
        clean_number = int(number) if number.is_integer() else number
        normalized.append((table, keys, clean_number))
    updated = deepcopy(scenario)
    tables = updated['data_input'].setdefault('df_parameters', {})
    for table, keys, clean_number in normalized:
        set_cell(tables, table, keys, clean_number, result['periods'])
    return updated

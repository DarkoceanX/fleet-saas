"""Portable trip cost reference; Python 3.11+, no external dependencies."""
import json
import re
import sys
from decimal import Decimal, ROUND_HALF_UP, ROUND_CEILING, localcontext
from pathlib import Path

FIELDS = (
    'loaded_km', 'empty_km', 'fuel_l_per_100km', 'fuel_price_per_l',
    'driver_hours', 'driver_rate_per_hour', 'maintenance_per_km',
    'depreciation_per_km', 'tolls', 'other_direct', 'overhead_rate', 'target_margin',
)
CENT = Decimal('0.01')


def number(value, name):
    if not isinstance(value, str) or not re.fullmatch(r'\d{1,12}(?:\.\d{1,6})?', value):
        raise ValueError(f'{name}: expected a nonnegative decimal string, up to 6 fractional digits')
    result = Decimal(value)
    if result >= Decimal('1000000000000'):
        raise ValueError(f'{name}: magnitude is too large')
    return result


def calculate(data):
    if not isinstance(data, dict):
        raise ValueError('Input must be a JSON object')
    missing = set(FIELDS) | {'currency'}
    missing -= data.keys()
    extra = data.keys() - set(FIELDS) - {'currency', 'revenue'}
    if missing or extra:
        raise ValueError(f'Missing fields: {sorted(missing)}; unknown fields: {sorted(extra)}')
    if data['currency'] != 'RUB':
        raise ValueError('This reference supports RUB only; define currency precision before extending')
    x = {key: number(data[key], key) for key in FIELDS}
    revenue = number(data['revenue'], 'revenue') if 'revenue' in data else None
    if x['overhead_rate'] > 1:
        raise ValueError('overhead_rate must be between 0 and 1')
    if x['target_margin'] >= 1:
        raise ValueError('target_margin must be less than 1')
    with localcontext() as ctx:
        ctx.prec = 80
        def money(value):
            return value.quantize(CENT, rounding=ROUND_HALF_UP)
        distance = x['loaded_km'] + x['empty_km']
        liters = distance * x['fuel_l_per_100km'] / 100
        lines = {
            'fuel': money(liters * x['fuel_price_per_l']),
            'driver': money(x['driver_hours'] * x['driver_rate_per_hour']),
            'maintenance': money(distance * x['maintenance_per_km']),
            'depreciation': money(distance * x['depreciation_per_km']),
            'tolls': money(x['tolls']),
            'other_direct': money(x['other_direct']),
        }
        direct = sum(lines.values(), Decimal(0))
        overhead = money(direct * x['overhead_rate'])
        total = direct + overhead
        price = (total / (1 - x['target_margin'])).quantize(CENT, rounding=ROUND_CEILING)
        # The money snapshot is rounded before profit and margin are computed.
        revenue = money(revenue) if revenue is not None else None
        profit = revenue - total if revenue is not None else None
        margin = (profit / revenue).quantize(Decimal('0.000001'), rounding=ROUND_HALF_UP) if revenue else None
        return {
            'calculation_version': '1', 'currency': 'RUB',
            'distance_km': format(distance, 'f'), 'fuel_liters': format(liters, 'f'),
            'lines': {k: format(v, '.2f') for k, v in lines.items()},
            'direct': format(direct, '.2f'), 'overhead': format(overhead, '.2f'),
            'total': format(total, '.2f'), 'target_price': format(price, '.2f'),
            'cost_per_km': format(money(total / distance), '.2f') if distance else None,
            'revenue': format(revenue, '.2f') if revenue is not None else None,
            'profit': format(profit, '.2f') if profit is not None else None,
            'actual_margin': format(margin, '.6f') if margin is not None else None,
        }


def unique_object(pairs):
    data = {}
    for key, value in pairs:
        if key in data:
            raise ValueError(f'Duplicate JSON field: {key}')
        data[key] = value
    return data


def main():
    if len(sys.argv) != 2:
        print('Usage: python scripts/calculate_trip.py examples/trip-cost.json', file=sys.stderr)
        return 2
    try:
        data = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'), object_pairs_hook=unique_object)
        print(json.dumps(calculate(data), indent=2, ensure_ascii=False))
    except (OSError, UnicodeError, ValueError) as exc:
        print(f'Invalid trip input: {exc}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

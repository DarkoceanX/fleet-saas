import json
from pathlib import Path
import sys
import unittest
from decimal import Decimal

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from calculate_trip import calculate, unique_object


class TripCostTests(unittest.TestCase):
    def setUp(self):
        self.trip = json.loads((ROOT / 'examples/trip-cost.json').read_text(encoding='utf-8'))

    def test_reference_trip(self):
        actual = calculate(self.trip)
        for field, expected in {
            'distance_km': '600', 'fuel_liters': '180', 'direct': '21800.00',
            'overhead': '2180.00', 'total': '23980.00', 'target_price': '29975.00',
            'cost_per_km': '39.97', 'profit': '6020.00', 'actual_margin': '0.200667',
        }.items():
            self.assertEqual(actual[field], expected, field)

    def test_displayed_lines_reconcile(self):
        self.trip.update(tolls='1.005', other_direct='2.005')
        result = calculate(self.trip)
        self.assertEqual(result['lines']['tolls'], '1.01')
        self.assertEqual(result['lines']['other_direct'], '2.01')
        self.assertEqual(sum(map(Decimal, result['lines'].values())), Decimal(result['direct']))
        self.assertEqual(Decimal(result['direct']) + Decimal(result['overhead']), Decimal(result['total']))

    def test_zero_distance_and_revenue(self):
        self.trip.update(loaded_km='0', empty_km='0', revenue='0')
        result = calculate(self.trip)
        self.assertIsNone(result['cost_per_km'])
        self.assertIsNone(result['actual_margin'])
        self.assertEqual(result['total'], '7480.00')
        self.assertEqual(result['profit'], '-7480.00')

    def test_optional_revenue(self):
        del self.trip['revenue']
        result = calculate(self.trip)
        self.assertIsNone(result['revenue'])
        self.assertIsNone(result['profit'])
        self.assertIsNone(result['actual_margin'])

    def test_price_rounds_up_to_preserve_target_margin(self):
        for key in self.trip:
            if key != 'currency':
                self.trip[key] = '0'
        self.trip.update(tolls='1', target_margin='0.3')
        result = calculate(self.trip)
        self.assertEqual(result['target_price'], '1.43')
        price = Decimal(result['target_price'])
        self.assertGreaterEqual((price - Decimal(result['total'])) / price, Decimal('.3'))

    def test_margin_boundary(self):
        self.trip['target_margin'] = '0.999999'
        self.assertEqual(calculate(self.trip)['target_price'], '23980000000.00')
        self.trip['target_margin'] = '1'
        with self.assertRaises(ValueError):
            calculate(self.trip)

    def test_invalid_numbers(self):
        for value in ['-1', 'NaN', 'Infinity', '', '1,5', '1e3', '0.0000001', '1000000000000', 1.5, True, None]:
            with self.subTest(value=value):
                bad = dict(self.trip, loaded_km=value)
                with self.assertRaises(ValueError):
                    calculate(bad)

    def test_shape_and_currency(self):
        for data in [[], {}, dict(self.trip, unexpected='1'), dict(self.trip, currency='USD'), dict(self.trip, overhead_rate='1.01')]:
            with self.subTest(data=data):
                with self.assertRaises(ValueError):
                    calculate(data)

    def test_empty_mileage_adds_cost(self):
        without = calculate(dict(self.trip, empty_km='0'))
        with_empty = calculate(self.trip)
        self.assertGreater(Decimal(with_empty['total']), Decimal(without['total']))

    def test_zero_margin(self):
        result = calculate(dict(self.trip, target_margin='0'))
        self.assertEqual(result['target_price'], result['total'])

    def test_revenue_rounded_before_profit(self):
        result = calculate(dict(self.trip, revenue='30000.005'))
        self.assertEqual(result['revenue'], '30000.01')
        self.assertEqual(result['profit'], '6020.01')

    def test_duplicate_json_field(self):
        with self.assertRaises(ValueError):
            json.loads('{"tolls":"1","tolls":"2"}', object_pairs_hook=unique_object)


if __name__ == '__main__':
    unittest.main()

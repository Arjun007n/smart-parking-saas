import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from plate_text import clean, is_valid, repair  # noqa: E402


class PlateText(unittest.TestCase):
    def test_clean(self):
        self.assertEqual(clean("dl 01-ab 1234"), "DL01AB1234")
        self.assertEqual(clean(None), "")
        self.assertEqual(clean("  MH.12 ab|1234 "), "MH12AB1234")

    def test_valid_shapes(self):
        for good in ["DL01AB1234", "MH12DE1433", "DL1CAB1234", "KA05A1234", "22BH1234AB"]:
            self.assertTrue(is_valid(good), good)
        for bad in ["XX01AB1234", "DL00AB1234", "DL01AB123", "ABCDEFGHIJ", "DL01AB12345", ""]:
            self.assertFalse(is_valid(bad), bad)

    def test_a_correct_plate_is_left_alone(self):
        self.assertEqual(repair("DL01AB1234"), ("DL01AB1234", False))
        self.assertEqual(repair("dl 01 ab 1234"), ("DL01AB1234", False))

    def test_look_alike_characters_are_repaired_by_position(self):
        self.assertEqual(repair("DLO1AB1234"), ("DL01AB1234", True))   # O in a digit place
        self.assertEqual(repair("MH12DE143S"), ("MH12DE1435", True))   # S in the number
        self.assertEqual(repair("HR26EF789O"), ("HR26EF7890", True))
        self.assertEqual(repair("KA0SAB1234"), ("KA05AB1234", True))   # district 0 is impossible, S is 5
        self.assertEqual(repair("DL01A81234"), ("DL01AB1234", True))   # 8 in the series

    def test_extra_characters_at_the_edges(self):
        self.assertEqual(repair("1HR26EF7890")[0], "HR26EF7890")
        self.assertEqual(repair("IND DL01AB1234")[0], "DL01AB1234")

    def test_no_guessing_when_the_fix_is_not_safe(self):
        # an invented state code is never "repaired" into a real one
        self.assertEqual(repair("XX01AB1234"), ("XX01AB1234", False))
        # too short to be a plate
        self.assertEqual(repair("MH12AB1"), ("MH12AB1", False))
        # too many wrong characters
        self.assertEqual(repair("0O0O0O0O0O")[1], False)
        self.assertEqual(repair(""), ("", False))

    def test_repair_never_changes_more_than_it_should(self):
        # whatever is returned as repaired must be a valid plate
        for raw in ["DLO1AB1234", "MH12DE143S", "MH12AB12345", "KA0SAB1234"]:
            plate, repaired = repair(raw)
            if repaired:
                self.assertTrue(is_valid(plate), plate)


if __name__ == "__main__":
    unittest.main()

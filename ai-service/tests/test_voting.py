import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from voting import PlateVoter  # noqa: E402


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


class Voting(unittest.TestCase):
    def make(self, **kw):
        self.clock = Clock()
        return PlateVoter(clock=self.clock, **kw)

    def test_one_read_is_not_enough_two_are(self):
        voter = self.make(min_reads=2)
        self.assertIsNone(voter.add("DL01AB1234", 0.9))
        result = voter.add("DL01AB1234", 0.8)
        self.assertEqual(result["plate"], "DL01AB1234")
        self.assertEqual(result["reads"], 2)
        self.assertAlmostEqual(result["confidence"], 0.85, places=3)

    def test_a_car_standing_still_is_one_event(self):
        voter = self.make(min_reads=2, cooldown_s=30)
        voter.add("DL01AB1234", 0.9)
        self.assertIsNotNone(voter.add("DL01AB1234", 0.9))
        for _ in range(10):
            self.clock.now += 1
            self.assertIsNone(voter.add("DL01AB1234", 0.9))
        self.clock.now += 40  # after the cooldown the same plate may be reported again
        voter.add("DL01AB1234", 0.9)
        self.assertIsNotNone(voter.add("DL01AB1234", 0.9))

    def test_one_wrong_character_still_counts_as_the_same_plate(self):
        voter = self.make(min_reads=3)
        voter.add("DL01AB1234", 0.9)
        voter.add("DL01AB1Z34", 0.7)
        result = voter.add("DL01AB1234", 0.9)
        self.assertEqual(result["plate"], "DL01AB1234", "the most common wording wins")
        self.assertEqual(result["reads"], 3)

    def test_a_flickering_jitter_of_the_reported_plate_is_not_a_new_event(self):
        voter = self.make(min_reads=2, cooldown_s=30)
        voter.add("DL01AB1234", 0.9)
        voter.add("DL01AB1234", 0.9)
        self.assertIsNone(voter.add("DL01AB1Z34", 0.9))
        self.assertIsNone(voter.add("DL01AB1Z34", 0.9))

    def test_reads_that_are_too_old_do_not_count(self):
        voter = self.make(min_reads=2, window_s=3)
        voter.add("MH12AB1234", 0.9)
        self.clock.now += 5
        self.assertIsNone(voter.add("MH12AB1234", 0.9))

    def test_different_plates_do_not_vote_together(self):
        voter = self.make(min_reads=2)
        voter.add("MH12AB1234", 0.9)
        self.assertIsNone(voter.add("UP16CD5678", 0.9))
        self.assertIsNone(voter.add("HR26EF7890", 0.9))

    def test_unsure_reads_are_not_reported(self):
        voter = self.make(min_reads=2, min_confidence=0.6)
        voter.add("MH12AB1234", 0.3)
        self.assertIsNone(voter.add("MH12AB1234", 0.4))

    def test_a_valid_plate_wins_a_tie(self):
        voter = self.make(min_reads=2)
        voter.add("DL01AB1Z34", 0.9)
        result = voter.add("DL01AB1234", 0.9)
        self.assertEqual(result["plate"], "DL01AB1234")

    def test_empty_text_is_ignored(self):
        voter = self.make(min_reads=1)
        self.assertIsNone(voter.add("", 0.9))


if __name__ == "__main__":
    unittest.main()

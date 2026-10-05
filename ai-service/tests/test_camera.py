import os
import sys
import threading
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from camera.rtsp_stream import FrameSource  # noqa: E402

quiet = lambda *a: None  # noqa: E731


class FakeCapture:
    def __init__(self, frames, opens=True):
        self.frames = list(frames)
        self.opens = opens
        self.released = False

    def isOpened(self):  # noqa: N802
        return self.opens

    def read(self):
        if not self.frames:
            return False, None
        time.sleep(0.005)
        return True, self.frames.pop(0)

    def release(self):
        self.released = True


def wait_for(check, seconds=3.0):
    end = time.time() + seconds
    while time.time() < end:
        if check():
            return True
        time.sleep(0.01)
    return check()


class Camera(unittest.TestCase):
    def test_keeps_only_the_newest_frame_and_numbers_them(self):
        made = []

        def factory(source):
            cap = FakeCapture(range(1, 6))
            made.append(cap)
            return cap

        stream = FrameSource("rtsp://cam/stream", capture_factory=factory, retry_min_s=0.01, retry_max_s=0.02, log=quiet).start()
        try:
            self.assertTrue(wait_for(lambda: stream.read()[0] == 5))
            frame, seq = stream.read()
            self.assertEqual(frame, 5)
            self.assertEqual(seq, 5)
        finally:
            stream.stop()

    def test_online_follows_the_frames_and_goes_offline_when_they_stop(self):
        now = [0.0]

        def factory(source):
            return FakeCapture([1, 2, 3])

        stream = FrameSource("rtsp://cam/stream", capture_factory=factory, offline_after_s=10, retry_min_s=5, retry_max_s=5, clock=lambda: now[0], log=quiet)
        self.assertFalse(stream.online, "no picture yet")
        stream.start()
        try:
            self.assertTrue(wait_for(lambda: stream.read()[1] >= 3))
            self.assertTrue(stream.online)
            now[0] += 11
            self.assertFalse(stream.online, "no new picture for longer than offline_after_s")
        finally:
            stream.stop()

    def test_reconnects_after_the_stream_drops(self):
        attempts = []

        def factory(source):
            attempts.append(1)
            if len(attempts) == 1:
                return FakeCapture([], opens=False)  # first attempt: camera not reachable
            return FakeCapture([7, 8, 9])

        stream = FrameSource("rtsp://cam/stream", capture_factory=factory, retry_min_s=0.01, retry_max_s=0.02, log=quiet).start()
        try:
            self.assertTrue(wait_for(lambda: stream.read()[0] == 9))
            self.assertGreaterEqual(len(attempts), 2)
            self.assertGreaterEqual(stream.reconnects, 1)
        finally:
            stream.stop()

    def test_a_factory_that_raises_is_retried(self):
        calls = []

        def factory(source):
            calls.append(1)
            if len(calls) < 3:
                raise RuntimeError("boom")
            return FakeCapture([1])

        stream = FrameSource(0, capture_factory=factory, retry_min_s=0.01, retry_max_s=0.02, log=quiet).start()
        try:
            self.assertTrue(wait_for(lambda: stream.read()[0] == 1))
        finally:
            stream.stop()

    def test_a_video_file_loops(self):
        def factory(source):
            return FakeCapture([1, 2])

        stream = FrameSource("clip.mp4", loop_file=True, capture_factory=factory, retry_min_s=0.01, log=quiet).start()
        try:
            self.assertTrue(wait_for(lambda: stream.read()[1] >= 6, 5.0), "the file starts again instead of ending")
        finally:
            stream.stop()

    def test_stop_ends_the_thread(self):
        stream = FrameSource(0, capture_factory=lambda s: FakeCapture([1]), retry_min_s=0.01, log=quiet).start()
        stream.stop()
        self.assertFalse(any(t.name == "camera" and t.is_alive() for t in threading.enumerate()))


if __name__ == "__main__":
    unittest.main()

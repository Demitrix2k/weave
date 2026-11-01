import importlib.machinery
import importlib.util
import json
import os
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def load_helper():
    path = os.path.join(HERE, "weave-state")
    loader = importlib.machinery.SourceFileLoader("weave_state", path)
    spec = importlib.util.spec_from_loader("weave_state", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


helper = load_helper()


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "sub", "state.json")
        self.store = helper.StateStore(self.path, max_bytes=1000)

    def test_missing_file_reads_as_empty_object(self):
        self.assertEqual(self.store.read(), "{}")

    def test_write_then_read_round_trips_and_leaves_no_temp_file(self):
        text = json.dumps({"version": 1, "records": [{"k": "å"}]})
        self.store.write(text)
        self.assertEqual(self.store.read(), text)
        self.assertEqual(os.listdir(os.path.dirname(self.path)), ["state.json"])

    def test_failed_write_keeps_the_old_file(self):
        self.store.write('{"a": 1}')
        for bad in ["[]", "nope", "", '"s"', "x" * 2000, None, 5]:
            with self.assertRaises(ValueError):
                self.store.write(bad)
        self.assertEqual(self.store.read(), '{"a": 1}')
        self.assertEqual(os.listdir(os.path.dirname(self.path)), ["state.json"])

    def test_size_limit_counts_bytes_not_characters(self):
        text = json.dumps({"k": "å" * 600}, ensure_ascii=False)
        self.assertLess(len(text), 1000)
        with self.assertRaises(ValueError):
            self.store.write(text)

    def test_corrupt_file_reads_as_empty_and_is_kept_as_bad(self):
        os.makedirs(os.path.dirname(self.path))
        for content in [b"{broken", b"[1]", b"\xff\xfe", b"x" * 2000]:
            with open(self.path, "wb") as handle:
                handle.write(content)
            self.assertEqual(self.store.read(), "{}")
            self.assertFalse(os.path.exists(self.path))
            with open(self.path + ".bad", "rb") as handle:
                self.assertEqual(handle.read(), content)
            os.unlink(self.path + ".bad")

    def test_default_path_follows_xdg_state_home(self):
        old = os.environ.get("XDG_STATE_HOME")
        os.environ["XDG_STATE_HOME"] = "/x/state"
        try:
            self.assertEqual(helper.default_path(), "/x/state/weave/state.json")
        finally:
            if old is None:
                del os.environ["XDG_STATE_HOME"]
            else:
                os.environ["XDG_STATE_HOME"] = old


if __name__ == "__main__":
    unittest.main()

import os
import sys

# Reconfigure stdout and stderr to UTF-8 to prevent UnicodeEncodeError on Windows terminals
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Get the directory of path_utils.py (which is in server/)
server_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.abspath(os.path.join(server_dir, ".."))

# Add project_root and server_dir to sys.path to ensure imports work from anywhere
if project_root not in sys.path:
    sys.path.insert(0, project_root)
if server_dir not in sys.path:
    sys.path.insert(0, server_dir)

def get_project_path(*paths):
    return os.path.join(project_root, *paths)

def get_server_path(*paths):
    return os.path.join(server_dir, *paths)

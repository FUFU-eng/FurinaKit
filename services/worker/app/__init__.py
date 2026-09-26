# The polling worker (worker.py) imports app.config / app.tasks directly and must
# NOT pull in the FastAPI HTTP app. `uvicorn app.main:app` imports app.main on its own.

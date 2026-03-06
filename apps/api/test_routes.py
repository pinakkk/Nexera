from fastapi import FastAPI
from app.api.v1 import router as v1_router, health_router
print(health_router.routes)

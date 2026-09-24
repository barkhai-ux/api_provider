from fastapi import APIRouter

from app.api.v1 import geocoding, routing

router = APIRouter(prefix="/v1")
router.include_router(geocoding.router)
router.include_router(routing.router)

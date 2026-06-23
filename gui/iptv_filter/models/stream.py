from dataclasses import dataclass
from typing import Optional

@dataclass
class Stream:
    channel: Optional[str] = None
    feed: Optional[str] = None
    title: str = ""
    url: str = ""
    referrer: Optional[str] = None
    user_agent: Optional[str] = None
    quality: Optional[str] = None
    label: Optional[str] = None

import re
with open("apps/api/app/schemas/runs.py", "r") as f:
    content = f.read()

# Add thread_id to RunCreateRequest
content = re.sub(
    r'(class RunCreateRequest\(BaseModel\):\n.*?query: str = Field[^\n]*\n)',
    r'\1    thread_id: str | None = Field(default=None, description="Group runs into a chat thread")\n',
    content,
    flags=re.DOTALL
)

# Add thread_id to RunStatus
content = re.sub(
    r'(class RunStatus\(BaseModel\):\n.*?id: uuid\.UUID\n)',
    r'\1    thread_id: str | None = None\n',
    content,
    flags=re.DOTALL
)

with open("apps/api/app/schemas/runs.py", "w") as f:
    f.write(content)

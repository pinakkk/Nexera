def _list():
    pipeline = [
        {"$match": {}},
        {"$sort": {"created_at": -1}},
        {"$group": {
            "_id": {"$ifNull": ["$thread_id", "$id"]},
            "doc": {"$first": "$$ROOT"}
        }},
        {"$replaceRoot": {"newRoot": "$doc"}},
        {"$sort": {"created_at": -1}},
        {"$skip": 0},
        {"$limit": 20}
    ]
    print(pipeline)
_list()

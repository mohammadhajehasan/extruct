import io, requests, zipfile

# Test with Arabic content that might cause encoding issues
test_cases = [
    {
        'name': 'Simple ASCII',
        'headers': ['Name', 'Value'],
        'rows': [['a', '1'], ['b', '2']]
    },
    {
        'name': 'Arabic', 
        'headers': ['الاسم', 'القيمة'],
        'rows': [['أحمد', '100'], ['سارة', '200']]
    },
    {
        'name': 'Mixed Arabic/English',
        'headers': ['الاسم', 'Name', 'القيمة', 'Value'], 
        'rows': [['أحمد', 'Ahmed', '100', '100'], ['سارة', 'Sara', '200', '200']]
    },
    {
        'name': 'Large dataset',
        'headers': ['Col' + str(i) for i in range(10)],
        'rows': [[str(j) + '_' + str(i) for j in range(5)] for i in range(10)]  # 10x5 grid
    }
]

for case in test_cases:
    print(f'\n=== {case["name"]} ===')
    
    # Test CSV
    resp = requests.post('http://127.0.0.1:8000/api/export', json={
        'kind': 'tables', 'format': 'csv',
        'headers': case['headers'],
        'rows': case['rows']
    })
    print(f'CSV: {resp.status_code} ({len(resp.content)} bytes)')
    if resp.status_code != 200:
        print(f'  Error: {resp.text[:200]}')
    
    # Test XLSX  
    resp = requests.post('http://127.0.0.1:8000/api/export', json={
        'kind': 'tables', 'format': 'xlsx',
        'headers': case['headers'],
        'rows': case['rows']
    })
    print(f'XLSX: {resp.status_code} ({len(resp.content)} bytes)')
    if resp.status_code == 200:
        buf = io.BytesIO(resp.content)
        try:
            with zipfile.ZipFile(buf) as zf:
                corrupt = zf.testzip()
                print(f'  ZIP Valid: {corrupt is None}')
                if corrupt:
                    print(f'  Corrupt file: {corrupt}')
        except Exception as e:
            print(f'  ZIP Error: {e}')
    else:
        print(f'  Error: {resp.text[:200]}')
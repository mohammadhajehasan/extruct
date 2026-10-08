import io, requests, zipfile
import openpyxl

resp = requests.post('http://127.0.0.1:8000/api/export', json={
    'kind': 'tables', 'format': 'xlsx',
    'headers': ['الاسم', 'Name', 'القيمة', 'Value'],
    'rows': [['أحمد', 'Ahmed', '100', '100'], ['سارة', 'Sara', '200', '200']]
})

buf = io.BytesIO(resp.content)
wb = openpyxl.load_workbook(buf)
ws = wb.active
print('Sheet name:', repr(ws.title))
print('rightToLeft:', ws.sheet_view.rightToLeft)
print('Freeze panes:', ws.freeze_panes)
print('\nRow contents:')
for row in ws.iter_rows(values_only=True):
    print(row)
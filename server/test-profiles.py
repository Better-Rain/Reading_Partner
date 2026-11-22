"""Exercise private profiles on an isolated staging service with a copied legacy library."""
import os
import hashlib
import http.client
import json
import pathlib
import re
import secrets
import ssl
import sys
import urllib.parse

stage=pathlib.Path(sys.argv[1]).resolve()
port = int(os.environ.get('RP_TEST_PORT', '18444'))
ctx=ssl.create_default_context(cafile=str(stage/'tls/ca.pem'))
class Client:
    def __init__(self,device):
        self.cookies={'__Host-rp':(pathlib.Path.home()/'ReadingPartner/data'/f'{device}.pair').read_text().strip()};self.tag=''
    def request(self,method,path,body=None,ctype='application/json'):
        conn=http.client.HTTPSConnection('127.0.0.1',port,context=ctx,timeout=20)
        headers={'Cookie':'; '.join(k+'='+v for k,v in self.cookies.items()),'Content-Type':ctype,'X-RP-Session':self.tag,'Origin':f'https://127.0.0.1:{port}'}
        conn.request(method,path,body,headers);resp=conn.getresponse();content=resp.read();c=resp.getheader('Set-Cookie');status=resp.status;conn.close()
        if c:
            k,v=c.split(';')[0].split('=',1);self.cookies[k]=v
        return status,content
    def login(self,name,password,action='login'):
        assert self.request('POST','/auth/'+action,urllib.parse.urlencode({'name':name,'password':password}),'application/x-www-form-urlencoded')[0]==303
        html=self.request('GET','/')[1].decode();self.tag=re.search(r'name="rp-session" content="([a-f0-9]+)"',html)[1]
    def rpc(self,ch,*args):
        status,b=self.request('POST','/rpc/'+ch,json.dumps(args));assert status==200,(ch,status,b[:100]);v=json.loads(b.splitlines()[-1]);assert 'error' not in v,(ch,v);return v.get('value') if 'done' in v else v
owner=Client('windows');other=Client(os.environ.get('RP_TEST_ANDROID_DEVICE', 'android'));assert other.request('POST','/rpc/documents:list','[]')[0]==403
owner.login('owner',(stage/'data/owner-initial-password').read_text().strip());name='qa'+secrets.token_hex(4);pw=secrets.token_urlsafe(15);other.login(name,pw,'register')
legacy=owner.rpc('documents:list');fresh=other.rpc('documents:list');assert {d['id'] for d in fresh}=={d['id'] for d in legacy} and all(d['lastPageNumber']==1 for d in fresh)
assert sum(len(owner.rpc('annotations:list',d['id'])) for d in legacy)>0
assert all(not other.rpc('annotations:list',d['id']) for d in fresh)
assert not other.rpc('vocabulary:list')
pdf=b'%PDF-1.4\n% stage '+secrets.token_bytes(12)+b'\n%%EOF';s,b=other.request('POST','/books?name=probe.pdf',pdf,'application/pdf');assert s==200,b;book=json.loads(b)['id'];assert owner.request('GET','/pdf/'+book)==(200,pdf);assert json.loads(owner.request('POST','/books?name=copy.pdf',pdf,'application/pdf')[1])['id']==book
other.rpc('documents:saveProgress',book,7);note=other.rpc('annotations:create',{'documentId':book,'type':'note','pageNumber':7,'note':'my private note'});other.rpc('vocabulary:create',{'documentId':book,'word':'isolation','definition':'test','pageNumber':7});chat=other.rpc('ai:createConversation',book,'private chat');assert other.rpc('annotations:list',book)[0]['id']==note['id'];assert other.rpc('ai:conversations',book)[0]['id']==chat['id']
assert next(d for d in owner.rpc('documents:list') if d['id']==book)['lastPageNumber']==1
assert owner.rpc('annotations:list',book)==[] and owner.rpc('vocabulary:list',book)==[] and owner.rpc('ai:conversations',book)==[] and owner.rpc('marks:export',book)['annotations']==[]
second=Client('windows');second.login(name,pw);assert next(d for d in second.rpc('documents:list') if d['id']==book)['lastPageNumber']==7 and len(second.rpc('annotations:list',book))==1
old=other.tag;assert other.request('POST','/auth/logout','')[0]==303;assert other.request('POST','/rpc/documents:list','[]')[0]==403;other.login('owner',(stage/'data/owner-initial-password').read_text().strip());other.tag=old;assert other.request('POST','/rpc/documents:saveProgress',json.dumps([book,2]))[0]==409
print('PASS legacy migration, shared upload/download, content deduplication, private progress/notes/vocabulary/chats/export, cross-device login, logout and stale-tab write protection')

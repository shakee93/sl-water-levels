# usage: aggregate.py DATADIR OUT.json
# (fetch_gsmap.py header says how the DATADIR is made; the output feeds scripts/fit-storm-model-v4.mjs --gs)
# usage: aggregate.py DATADIR OUT.json  -- per-catchment hourly mean rain rate for each product, on the END-of-hour grid (hour started at file stamp).
# Same cell -> pixel rule as scripts/gsmap-snapshot.mjs: each catchment cell goes to the nearest 0.1 degree pixel, unique pixels averaged.
import sys, os, json, glob, datetime as dt
import numpy as np
D,OUT=sys.argv[1],sys.argv[2]
REPO=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..')
cat=json.load(open(os.path.join(REPO,'lib/model/catchments.json')))['basins']
R0,C0=500,794
pix={}
for b,v in cat.items():
    for st,s in v['stations'].items():
        ps=set()
        for i in s['cells']:
            lat,lon=v['grid'][i]; r=round((59.95-lat)/0.1)-R0; c=round((lon-0.05)/0.1)-C0; ps.add((r,c))
        pix[f'{b}/{st}']=sorted(ps)
        sub=json.load(open(os.path.join(REPO,'lib/model/subcatchments.json')))[b][st]
        for nm in ('near','up'):
            q=set()
            for i in sub[nm]:
                lat,lon=v['grid'][i]; q.add((round((59.95-lat)/0.1)-R0,round((lon-0.05)/0.1)-C0))
            if q: pix[f'{b}/{st}#{nm}']=sorted(q)
prods=[p for p in ('nrt','gnrt','now0') if os.path.isdir(f'{D}/{p}')]
days=sorted(os.path.basename(f)[:8] for f in glob.glob(f'{D}/nrt/*.npy'))
d0=dt.datetime.strptime(days[0],'%Y%m%d').replace(tzinfo=dt.timezone.utc)
out={'t0End':int((d0.timestamp()+3600)*1000),'step':'hour; value i = mean rate (mm/h) of the hour STARTING at t0End-1h+i h, i.e. hour ENDING t0End+i h','products':{}}
ndays=(dt.datetime.strptime(days[-1],'%Y%m%d').replace(tzinfo=dt.timezone.utc)-d0).days+1
for p in prods:
    arr=np.full((ndays*24,42,27),np.nan,dtype=np.float32)
    for f in glob.glob(f'{D}/{p}/*.npy'):
        k=(dt.datetime.strptime(os.path.basename(f)[:8],'%Y%m%d').replace(tzinfo=dt.timezone.utc)-d0).days
        if 0<=k<ndays: arr[k*24:(k+1)*24]=np.load(f)
    res={}
    for key,ps in pix.items():
        rr=[a for a,b in ps]; cc=[b for a,b in ps]
        v=arr[:,rr,cc]               # (hours, npix)
        n=np.sum(~np.isnan(v),axis=1)
        m=np.where(n>0,np.nansum(v,axis=1)/np.maximum(n,1),np.nan)
        m[n<len(ps)]=np.nan if False else m[n<len(ps)]   # partial pixel coverage still counts
        res[key]=[None if np.isnan(x) else round(float(x),2) for x in m]
    out['products'][p]=res
    print(p,'hours',ndays*24,'missing share',float(np.mean(np.isnan(arr).all(axis=(1,2)))))
json.dump(out,open(OUT,'w'),separators=(',',':'))

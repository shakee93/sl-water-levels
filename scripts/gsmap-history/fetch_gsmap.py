# usage: fetch_gsmap.py START END OUTDIR NETRC [WORKERS]
# Streams JAXA GSMaP archive files for Sri Lanka (lat 5.85-9.95, lon 79.45-82.05 pixel centres), keeps only the crop, deletes the raw file.
# Products (each hour label = START of the hour, UTC, rate mm/h):
#   nrt   realtime/hourly/Y/M/D/gsmap_nrt.YMD.HH00        GSMaP_NRT
#   gnrt  realtime/hourly_G/Y/M/D/gsmap_gauge.YMD.HH00     Gauge_NRT (gauge-calibrated)
#   now0  now/half_hour/Y/M/D/gsmap_now.YMD.HH00           GSMaP_NOW, file on the hour
#   now30 now/half_hour/Y/M/D/gsmap_now.YMD.HH30           GSMaP_NOW, file on the half hour
# Out: OUTDIR/<prod>/YYYYMMDD.npy float32 (24, ROWS, COLS), NaN = missing/negative.
import sys, os, subprocess, gzip, datetime as dt, shutil, tempfile
import numpy as np
from concurrent.futures import ThreadPoolExecutor
start=dt.date.fromisoformat(sys.argv[1]); end=dt.date.fromisoformat(sys.argv[2]); OUT=sys.argv[3]; NETRC=sys.argv[4]
W=int(sys.argv[5]) if len(sys.argv)>5 else 10
B="ftp://hokusai.eorc.jaxa.jp"
R0,R1=int(round((59.95-9.95)/0.1)),int(round((59.95-5.85)/0.1)); C0,C1=int(round((79.45-0.05)/0.1)),int(round((82.05-0.05)/0.1))
NR,NC=R1-R0+1,C1-C0+1
PRODS={"nrt":("realtime/hourly","gsmap_nrt.{ymd}.{hh}00.dat.gz"),"gnrt":("realtime/hourly_G","gsmap_gauge.{ymd}.{hh}00.dat.gz"),
       "now0":("now/half_hour","gsmap_now.{ymd}.{hh}00.dat.gz")}
def job(arg):
    day,prod=arg
    f=f"{OUT}/{prod}/{day.strftime('%Y%m%d')}.npy"
    d,pat=PRODS[prod]; y,m,dd,ymd=day.strftime("%Y"),day.strftime("%m"),day.strftime("%d"),day.strftime("%Y%m%d")
    tmp=tempfile.mkdtemp(prefix="gs_"); arr=np.full((24,NR,NC),np.nan,dtype=np.float32); got=set()
    if os.path.exists(f):   # repair pass: keep the hours already there, fetch only the empty ones
        arr=np.load(f); got={h for h in range(24) if not np.isnan(arr[h]).all()}
        if len(got)==24: shutil.rmtree(tmp,ignore_errors=True); return (day,prod,0)
    try:
        for attempt in range(3):
            todo=[h for h in range(24) if h not in got]
            if not todo: break
            args=["curl","-s","--netrc-file",NETRC,"--max-time","900","--retry","2"]
            for h in todo: args+=["-f","-o",f"{tmp}/{h:02d}.gz",f"{B}/{d}/{y}/{m}/{dd}/"+pat.format(ymd=ymd,hh=f"{h:02d}")]
            subprocess.run(args,capture_output=True)
            for h in todo:
                p=f"{tmp}/{h:02d}.gz"
                if os.path.exists(p) and os.path.getsize(p)>1000:
                    try:
                        raw=gzip.decompress(open(p,"rb").read())
                        if len(raw)==17280000:
                            g=np.frombuffer(raw,dtype="<f4").reshape(1200,3600)[R0:R1+1,C0:C1+1].copy(); g[g<0]=np.nan; arr[h]=g; got.add(h)
                    except Exception: pass
                    os.remove(p)
        os.makedirs(os.path.dirname(f),exist_ok=True); np.save(f+".tmp.npy",arr); os.replace(f+".tmp.npy",f)
        return (day,prod,24-len(got))
    finally: shutil.rmtree(tmp,ignore_errors=True)
jobs=[]; d=start
while d<=end:
    for p in PRODS: jobs.append((d,p))
    d+=dt.timedelta(days=1)
print(len(jobs),"jobs; crop",NR,NC,R0,C0,flush=True)
with ThreadPoolExecutor(W) as ex:
    for i,(day,prod,miss) in enumerate(ex.map(job,jobs)):
        if miss or i%40==0: print(i,day,prod,"missing hours",miss,flush=True)
print("DONE",flush=True)

# 지도 파일 다시 만들기

앱은 `data/gyeongbuk-map.js` 하나만 씁니다. 지도를 바꿀 일이 없으면 이 폴더는 쓰지 않아도 됩니다.
방법과 이유는 `docs/map-data.md`에 있습니다. 원자료(약 18MB)는 저장소에 넣지 않습니다.

필요한 것: Node.js

```bash
curl -L -o muni.json https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2018/json/skorea-municipalities-2018-geo.json

# 경북 본토 + 이웃 시도: 포항 남·북구 합치기, 군위는 대구로, 경계를 공유한 채로 단순화
npx mapshaper muni.json \
  -filter '["37","32","33","22","26","21","38","35"].indexOf(code.slice(0,2))>=0 && code!="37430"' \
  -each 'gid = code.slice(0,2)=="37" ? (code=="37011"||code=="37012" ? "37010" : (code=="37310" ? "nb22" : code)) : "nb"+code.slice(0,2)' \
  -dissolve gid \
  -clip bbox=127.55,35.40,130.10,37.32 \
  -simplify 6% keep-shapes \
  -filter-islands min-area=2000000 \
  -o format=geojson precision=0.00001 main.json

# 울릉군(울릉도·독도)은 따로 꺼내 작은 상자 안에 옮겨 그림
npx mapshaper muni.json -filter 'code=="37430"' -explode -o format=geojson precision=0.00001 ulleung.json

npm i polylabel@1
node tools/build-map.mjs main.json ulleung.json data/gyeongbuk-map.js
```

결과 확인: "시군 22"가 나와야 합니다(22개가 아니면 멈춥니다).

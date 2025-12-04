import{p as w,f as L,o as H,b as d,a,Q as v,w as T,j as $,y as K,A as l,aH as le,b8 as Te,b1 as ce,Z as Ie,b2 as de,b9 as Q,k as Oe,_ as Ee,ba as Re,b5 as ue,v as E,x as D,bb as Ne,a8 as x,bc as me,bd as he,C as Ae,a4 as Se,c as B,h as pe,g as N,T as fe,U as ge,i as W,t as M}from"./index-CeLUWoxq.js";import{Q as j,a as He}from"./QTab-itnfnLfx.js";import{Q as _}from"./QTable-Bl7fqdbx.js";import{a as be,b as P,_ as Le}from"./_plugin-vue_export-helper-4I3emnXe.js";import{Q as V}from"./QItemLabel-ypDS4JLY.js";import"./QResizeObserver-D8N8_oaF.js";import"./QSelect-Kk523z3Q.js";import"./QMenu-D8sDMf8d.js";import"./position-engine-YKFLkhIK.js";import"./format-CJebrXOQ.js";const Ce={class:"row no-wrap justify-between items-center"},we={class:"row no-wrap items-center q-gutter-x-sm"},ye={__name:"helpHeader",props:{modelValue:{type:String,default:"api"}},emits:["update:modelValue"],setup(e,{emit:O}){const m=e,r=O,c=w(m.modelValue),i=t=>{c.value=t,r("update:modelValue",t)};return(t,s)=>(H(),L("div",Ce,[d("div",we,[a(v,{name:"help",size:"md",color:"primary"}),s[1]||(s[1]=d("div",{class:"text-title"},"Help",-1))]),a(He,{modelValue:c.value,"onUpdate:modelValue":[s[0]||(s[0]=I=>c.value=I),i],dense:""},{default:T(()=>[a(j,{name:"api",label:"API Guide"}),a(j,{name:"licenses",label:"Open Source Licenses"})]),_:1},8,["modelValue"])]))}},Fe=$({name:"QSlideTransition",props:{appear:Boolean,duration:{type:Number,default:300}},emits:["show","hide"],setup(e,{slots:O,emit:m}){let r=!1,c,i,t=null,s=null,I,b;function p(){c?.(),c=null,r=!1,t!==null&&(clearTimeout(t),t=null),s!==null&&(clearTimeout(s),s=null),i?.removeEventListener("transitionend",I),I=null}function R(n,u,h){u!==void 0&&(n.style.height=`${u}px`),n.style.transition=`height ${e.duration}ms cubic-bezier(.25, .8, .50, 1)`,r=!0,c=h}function f(n,u){n.style.overflowY=null,n.style.height=null,n.style.transition=null,p(),u!==b&&m(u)}function y(n,u){let h=0;i=n,r===!0?(p(),h=n.offsetHeight===n.scrollHeight?0:void 0):(b="hide",n.style.overflowY="hidden"),R(n,h,u),t=setTimeout(()=>{t=null,n.style.height=`${n.scrollHeight}px`,I=A=>{s=null,(Object(A)!==A||A.target===n)&&f(n,"show")},n.addEventListener("transitionend",I),s=setTimeout(I,e.duration*1.1)},100)}function F(n,u){let h;i=n,r===!0?p():(b="show",n.style.overflowY="hidden",h=n.scrollHeight),R(n,h,u),t=setTimeout(()=>{t=null,n.style.height=0,I=A=>{s=null,(Object(A)!==A||A.target===n)&&f(n,"hide")},n.addEventListener("transitionend",I),s=setTimeout(I,e.duration*1.1)},100)}return K(()=>{r===!0&&p()}),()=>l(le,{css:!1,appear:e.appear,onEnter:y,onLeave:F},O.default)}}),g=Te({}),De=Object.keys(Q),Me=$({name:"QExpansionItem",props:{...Q,...de,...Ie,icon:String,label:String,labelLines:[Number,String],caption:String,captionLines:[Number,String],dense:Boolean,toggleAriaLabel:String,expandIcon:String,expandedIcon:String,expandIconClass:[Array,String,Object],duration:{},headerInsetLevel:Number,contentInsetLevel:Number,expandSeparator:Boolean,defaultOpened:Boolean,hideExpandIcon:Boolean,expandIconToggle:Boolean,switchToggleSide:Boolean,denseToggle:Boolean,group:String,popup:Boolean,headerStyle:[Array,String,Object],headerClass:[Array,String,Object]},emits:[...ce,"click","afterShow","afterHide"],setup(e,{slots:O,emit:m}){const{proxy:{$q:r}}=Oe(),c=Ee(e,r),i=w(e.modelValue!==null?e.modelValue:e.defaultOpened),t=w(null),s=Re(),{show:I,hide:b,toggle:p}=ue({showing:i});let R,f;const y=E(()=>`q-expansion-item q-item-type q-expansion-item--${i.value===!0?"expanded":"collapsed"} q-expansion-item--${e.popup===!0?"popup":"standard"}`),F=E(()=>e.contentInsetLevel===void 0?null:{["padding"+(r.lang.rtl===!0?"Right":"Left")]:e.contentInsetLevel*56+"px"}),n=E(()=>e.disable!==!0&&(e.href!==void 0||e.to!==void 0&&e.to!==null&&e.to!=="")),u=E(()=>{const o={};return De.forEach(S=>{o[S]=e[S]}),o}),h=E(()=>n.value===!0||e.expandIconToggle!==!0),A=E(()=>e.expandedIcon!==void 0&&i.value===!0?e.expandedIcon:e.expandIcon||r.iconSet.expansionItem[e.denseToggle===!0?"denseIcon":"icon"]),X=E(()=>e.disable!==!0&&(n.value===!0||e.expandIconToggle===!0)),J=E(()=>({expanded:i.value===!0,detailsId:s.value,toggle:p,show:I,hide:b})),U=E(()=>{const o=e.toggleAriaLabel!==void 0?e.toggleAriaLabel:r.lang.label[i.value===!0?"collapse":"expand"](e.label);return{role:"button","aria-expanded":i.value===!0?"true":"false","aria-controls":s.value,"aria-label":o}});D(()=>e.group,o=>{f?.(),o!==void 0&&Y()});function z(o){n.value!==!0&&p(o),m("click",o)}function Z(o){o.keyCode===13&&G(o,!0)}function G(o,S){S!==!0&&o.qAvoidFocus!==!0&&t.value?.focus(),p(o),Se(o)}function ee(){m("afterShow")}function te(){m("afterHide")}function Y(){R===void 0&&(R=Ne()),i.value===!0&&(g[e.group]=R);const o=D(i,C=>{C===!0?g[e.group]=R:g[e.group]===R&&delete g[e.group]}),S=D(()=>g[e.group],(C,re)=>{re===R&&C!==void 0&&C!==R&&b()});f=()=>{o(),S(),g[e.group]===R&&delete g[e.group],f=void 0}}function oe(){const o={class:[`q-focusable relative-position cursor-pointer${e.denseToggle===!0&&e.switchToggleSide===!0?" items-end":""}`,e.expandIconClass],side:e.switchToggleSide!==!0,avatar:e.switchToggleSide},S=[l(v,{class:"q-expansion-item__toggle-icon"+(e.expandedIcon===void 0&&i.value===!0?" q-expansion-item__toggle-icon--rotated":""),name:A.value})];return X.value===!0&&(Object.assign(o,{tabindex:0,...U.value,onClick:G,onKeyup:Z}),S.unshift(l("div",{ref:t,class:"q-expansion-item__toggle-focus q-icon q-focus-helper q-focus-helper--rounded",tabindex:-1}))),l(P,o,()=>S)}function ie(){let o;return O.header!==void 0?o=[].concat(O.header(J.value)):(o=[l(P,()=>[l(V,{lines:e.labelLines},()=>e.label||""),e.caption?l(V,{lines:e.captionLines,caption:!0},()=>e.caption):null])],e.icon&&o[e.switchToggleSide===!0?"push":"unshift"](l(P,{side:e.switchToggleSide===!0,avatar:e.switchToggleSide!==!0},()=>l(v,{name:e.icon})))),e.disable!==!0&&e.hideExpandIcon!==!0&&o[e.switchToggleSide===!0?"unshift":"push"](oe()),o}function ne(){const o={ref:"item",style:e.headerStyle,class:e.headerClass,dark:c.value,disable:e.disable,dense:e.dense,insetLevel:e.headerInsetLevel};return h.value===!0&&(o.clickable=!0,o.onClick=z,Object.assign(o,n.value===!0?u.value:U.value)),l(be,o,ie)}function se(){return me(l("div",{key:"e-content",class:"q-expansion-item__content relative-position",style:F.value,id:s.value},Ae(O.default)),[[he,i.value]])}function ae(){const o=[ne(),l(Fe,{duration:e.duration,onShow:ee,onHide:te},se)];return e.expandSeparator===!0&&o.push(l(x,{class:"q-expansion-item__border q-expansion-item__border--top absolute-top",dark:c.value}),l(x,{class:"q-expansion-item__border q-expansion-item__border--bottom absolute-bottom",dark:c.value})),o}return e.group!==void 0&&Y(),K(()=>{f?.()}),()=>l("div",{class:y.value},[l("div",{class:"q-expansion-item__container relative-position"},ae())])}}),k={backend:[{name:"Electron",version:"^36.5.0",license:"MIT",description:"크로스 플랫폼 데스크톱 애플리케이션 프레임워크",repository:"https://github.com/electron/electron",licenseText:`MIT License

Copyright (c) Electron contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`},{name:"Express",version:"^4.18.0",license:"MIT",description:"빠르고 간결한 Node.js 웹 프레임워크",repository:"https://github.com/expressjs/express",licenseText:`MIT License

Copyright (c) 2009-present TJ Holowaychuk <tj@vision-media.ca>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`},{name:"Socket.IO",version:"^4.7.0",license:"MIT",description:"실시간 양방향 이벤트 기반 통신 라이브러리",repository:"https://github.com/socketio/socket.io",licenseText:`The MIT License (MIT)

Copyright (c) 2014-present Guillermo Rauch

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`},{name:"nedb-promises",version:"^6.2.3",license:"MIT",description:"JavaScript로 작성된 임베디드 NoSQL 데이터베이스",repository:"https://github.com/bajankristof/nedb-promises",licenseText:`MIT License

Copyright (c) 2013 Louis Chatriot

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`},{name:"fluent-ffmpeg",version:"^2.1.3",license:"MIT",description:"Node.js용 FFmpeg 래퍼",repository:"https://github.com/fluent-ffmpeg/node-fluent-ffmpeg",licenseText:`MIT License

Copyright (c) 2013 Stefan Schaermeli

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`},{name:"Multer",version:"^1.4.5-lts.1",license:"MIT",description:"multipart/form-data 처리를 위한 Node.js 미들웨어",repository:"https://github.com/expressjs/multer",licenseText:`Copyright (c) 2014 Hage Yaapa <http://www.hacksparrow.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`},{name:"Winston",version:"^3.17.0",license:"MIT",description:"범용 로깅 라이브러리",repository:"https://github.com/winstonjs/winston",licenseText:`MIT License

Copyright (c) 2010 Charlie Robbins

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`},{name:"Morgan",version:"^1.10.0",license:"MIT",description:"Node.js용 HTTP 요청 로거 미들웨어",repository:"https://github.com/expressjs/morgan",licenseText:`(The MIT License)

Copyright (c) 2014 Jonathan Ong <me@jongleberry.com>
Copyright (c) 2014-2017 Douglas Christopher Wilson <doug@somethingdoug.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`},{name:"CORS",version:"^2.8.5",license:"MIT",description:"Node.js CORS 미들웨어",repository:"https://github.com/expressjs/cors",licenseText:`(The MIT License)

Copyright (c) 2013 Troy Goode <troygoode@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`}],frontend:[{name:"Vue 3",version:"^3.5.13",license:"MIT",description:"프로그레시브 JavaScript 프레임워크",repository:"https://github.com/vuejs/core",licenseText:`The MIT License (MIT)

Copyright (c) 2018-present, Yuxi (Evan) You

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`},{name:"Quasar Framework",version:"^2.17.11",license:"MIT",description:"Vue.js 기반 반응형 UI 프레임워크",repository:"https://github.com/quasarframework/quasar",licenseText:`MIT License

Copyright (c) 2015-present Razvan Stoenescu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`},{name:"Vue Router",version:"^4.5.0",license:"MIT",description:"Vue.js용 공식 라우터",repository:"https://github.com/vuejs/router",licenseText:`The MIT License (MIT)

Copyright (c) 2019-present Eduardo San Martin Morote

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`},{name:"Pinia",version:"^2.3.0",license:"MIT",description:"Vue.js용 직관적이고 타입 안전한 상태 관리 라이브러리",repository:"https://github.com/vuejs/pinia",licenseText:`The MIT License (MIT)

Copyright (c) 2019-present Eduardo San Martin Morote

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`},{name:"Axios",version:"^1.7.9",license:"MIT",description:"Promise 기반 HTTP 클라이언트",repository:"https://github.com/axios/axios",licenseText:`Copyright (c) 2014-present Matt Zabriskie & Collaborators

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`},{name:"Socket.IO Client",version:"^4.8.1",license:"MIT",description:"실시간 양방향 이벤트 기반 통신 클라이언트",repository:"https://github.com/socketio/socket.io-client",licenseText:`The MIT License (MIT)

Copyright (c) 2014-2018 Guillermo Rauch

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`},{name:"time-convert",version:"^0.0.2",license:"MIT",description:"시간 변환 유틸리티 라이브러리",repository:"https://github.com/jonschlinkert/time-convert",licenseText:`MIT License

Copyright (c) 2018, Jon Schlinkert.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`},{name:"VueDraggable",version:"^4.1.0",license:"MIT",description:"Vue 3용 드래그 앤 드롭 라이브러리",repository:"https://github.com/SortableJS/vue.draggable.next",licenseText:`The MIT License (MIT)

Copyright (c) 2016-2019 David Desmaisons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`}]},q={commands:[{name:"play",description:"현재 미디어 재생",simple:"play",json:'{"command": "play"}',params:[]},{name:"pause",description:"일시정지",simple:"pause",json:'{"command": "pause"}',params:[]},{name:"stop",description:"정지",simple:"stop",json:'{"command": "stop"}',params:[]},{name:"playid",description:"ID로 파일 재생",simple:"playid,123",json:'{"command": "playid", "id": 123}',params:[{name:"id",type:"number",required:!0,description:"파일 ID"}]},{name:"next",description:"다음 트랙",simple:"next",json:'{"command": "next"}',params:[]},{name:"prev",description:"이전 트랙",simple:"prev",json:'{"command": "prev"}',params:[]},{name:"updatetime",description:"재생 시간 변경",simple:"updatetime,30000",json:'{"command": "updatetime", "time": 30000}',params:[{name:"time",type:"number",required:!0,description:"재생 시간(ms)"}]},{name:"fullscreen",description:"전체화면 토글",simple:"fullscreen",json:'{"command": "fullscreen"}',params:[]},{name:"getaudiodevices",description:"오디오 장치 목록 조회",simple:"getaudiodevices",json:'{"command": "getaudiodevices"}',params:[]},{name:"setaudiodevice",description:"오디오 장치 설정",simple:null,json:'{"command": "setaudiodevice", "device": "스피커"}',params:[{name:"device",type:"string",required:!0,description:"장치명"}]},{name:"playlistplay",description:"플레이리스트 재생",simple:"playlistplay,1,2",json:'{"command": "playlistplay", "id": 1, "track": 2}',params:[{name:"id",type:"number",required:!0,description:"플레이리스트 ID"},{name:"track",type:"number",required:!1,description:"트랙 번호"}]},{name:"imagetime",description:"이미지 표시 시간 설정",simple:"imagetime,5000",json:'{"command": "imagetime", "time": 5000}',params:[{name:"time",type:"number",required:!0,description:"표시 시간(ms)"}]},{name:"getfiles",description:"파일 목록 조회",simple:"getfiles",json:'{"command": "getfiles"}',params:[]},{name:"getplaylists",description:"플레이리스트 목록 조회",simple:"getplaylists",json:'{"command": "getplaylists"}',params:[]},{name:"getplaylist",description:"특정 플레이리스트 조회",simple:null,json:'{"command": "getplaylist", "id": 1}',params:[{name:"id",type:"number",required:!0,description:"플레이리스트 ID"}]}]},Pe={key:0},ve={key:1,class:"licenses-section"},We={class:"text-body2 q-mb-md"},Ue=["href"],Ge={class:"license-text q-mt-sm"},Ye={__name:"helpContent",props:{currentTab:{type:String,default:"api"}},setup(e){const O=e,m=E(()=>q.commands.filter(i=>i.simple).map(i=>({command:i.name,description:i.description,parameters:i.params.map(t=>`${t.name} (${t.type}, ${t.required?"필수":"선택"}): ${t.description}`).join(", ")||"",example:i.simple}))),r=E(()=>q.commands.filter(i=>i.json).map(i=>({command:i.name,description:i.description,parameters:i.params.map(t=>`${t.name} (${t.type}, ${t.required?"필수":"선택"}): ${t.description}`).join(", ")||"",response:"",example:i.json}))),c=E(()=>{const i=k.backend?.map(s=>({...s,type:"Backend"}))||[],t=k.frontend?.map(s=>({...s,type:"Frontend"}))||[];return[...i,...t]});return(i,t)=>(H(),B(W,{class:"q-px-md",flat:""},{default:T(()=>[O.currentTab==="api"?(H(),L("div",Pe,[a(N,null,{default:T(()=>t[0]||(t[0]=[d("div",{class:"text-h6"},"Terminal Commands(Simple)",-1)])),_:1,__:[0]}),a(N,null,{default:T(()=>[a(_,{rows:m.value,columns:[{name:"command",label:"Command",field:"command",align:"left"},{name:"description",label:"Description",field:"description",align:"left"},{name:"parameters",label:"Parameters",field:"parameters",align:"left"},{name:"example",label:"Example",field:"example",align:"left"}],"row-key":"command",flat:"",pagination:{rowsPerPage:0,page:1},"hide-bottom":"","no-data-label":"No commands available"},null,8,["rows"])]),_:1}),a(N,null,{default:T(()=>t[1]||(t[1]=[d("div",{class:"text-caption"}," Use these commands to control the video player via TCP connection. Each command can be sent as a simple string. ",-1)])),_:1,__:[1]}),a(N,null,{default:T(()=>t[2]||(t[2]=[d("div",{class:"text-h6"},"Terminal Commands(JSON)",-1)])),_:1,__:[2]}),a(N,null,{default:T(()=>[a(_,{rows:r.value,columns:[{name:"command",label:"Command",field:"command",align:"left"},{name:"description",label:"Description",field:"description",align:"left"},{name:"parameters",label:"Parameters",field:"parameters",align:"left"},{name:"example",label:"Example",field:"example",align:"left"}],"row-key":"command",flat:"",pagination:{rowsPerPage:0,page:1},"hide-bottom":"","no-data-label":"No commands available"},null,8,["rows"])]),_:1}),a(N,null,{default:T(()=>t[3]||(t[3]=[d("div",{class:"text-caption"}," Use these commands to interact with the video player via TCP connection. Each command can be sent as a JSON object. ",-1)])),_:1,__:[3]})])):e.currentTab==="licenses"?(H(),L("div",ve,[a(N,null,{default:T(()=>t[4]||(t[4]=[d("div",{class:"text-h5 q-mb-md"},"Open Source Licenses",-1),d("div",{class:"text-body2 text-grey-7"}," 이 프로젝트는 다음의 오픈소스 라이브러리를 사용합니다. ",-1)])),_:1,__:[4]}),a(N,null,{default:T(()=>[(H(!0),L(fe,null,ge(c.value,(s,I)=>(H(),B(Me,{key:`license-${I}`,label:s.name,caption:`${s.version} - ${s.license} (${s.type})`,class:"q-mb-sm","header-class":"bg-grey-2"},{default:T(()=>[a(W,null,{default:T(()=>[a(N,null,{default:T(()=>[t[5]||(t[5]=d("div",{class:"text-subtitle2"},"Description",-1)),d("div",We,M(s.description),1),t[6]||(t[6]=d("div",{class:"text-subtitle2"},"Repository",-1)),d("a",{href:s.repository,target:"_blank",class:"text-primary q-mb-md"},M(s.repository),9,Ue),t[7]||(t[7]=d("div",{class:"text-subtitle2 q-mt-md"},"License Text",-1)),d("pre",Ge,M(s.licenseText),1)]),_:2,__:[5,6,7]},1024)]),_:2},1024)]),_:2},1032,["label","caption"]))),128))]),_:1})])):pe("",!0)]),_:1}))}},xe=Le(Ye,[["__scopeId","data-v-9160069b"]]),Be={class:"q-pa-md"},ze={__name:"HelpPage",setup(e){const O=w("api");return(m,r)=>(H(),L("div",Be,[a(W,{flat:""},{default:T(()=>[a(N,{class:"q-py-none"},{default:T(()=>[a(ye,{modelValue:O.value,"onUpdate:modelValue":r[0]||(r[0]=c=>O.value=c)},null,8,["modelValue"])]),_:1}),a(N,{class:"q-py-xs"},{default:T(()=>[a(xe,{"current-tab":O.value},null,8,["current-tab"])]),_:1})]),_:1})]))}};export{ze as default};

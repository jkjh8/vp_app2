import{p as D,f as C,o as b,b as l,a as r,Q as G,w as a,j as X,y as J,A as d,aK as de,ba as Ie,b4 as Oe,a1 as ue,b5 as Ee,bb as z,k as Re,a2 as pe,bc as me,b8 as Ne,v as u,x as P,bd as he,ac as j,be as Ae,bf as Se,C as fe,a8 as ge,c as V,h as He,g as p,e as L,T as be,U as Le,i as x,t as W}from"./index-CMI8fg21.js";import{Q as k,a as ye}from"./QTab-CSXZB3Jp.js";import{a as q,Q as y}from"./QTable-crdr9YrL.js";import{a as we,b as U,_ as Ce}from"./_plugin-vue_export-helper-CCU2Bbkb.js";import{Q as $}from"./QItemLabel-CfX0SEcR.js";import{a as w}from"./useUtils-DkNQq_hh.js";import"./QResizeObserver-Cx280vV1.js";import"./QSelect-DQp47Ka2.js";import"./QMenu-DBBYTg9X.js";import"./position-engine-DDCaqjFR.js";import"./format-CJebrXOQ.js";import"./use-quasar-DgFj2L67.js";const Fe={class:"row no-wrap justify-between items-center"},De={class:"row no-wrap items-center q-gutter-x-sm"},Me={__name:"helpHeader",props:{modelValue:{type:String,default:"api"}},emits:["update:modelValue"],setup(e,{emit:O}){const m=e,T=O,I=D(m.modelValue),c=n=>{I.value=n,T("update:modelValue",n)};return(n,t)=>(b(),C("div",Fe,[l("div",De,[r(G,{name:"help",size:"md",color:"primary"}),t[1]||(t[1]=l("div",{class:"text-title"},"Help",-1))]),r(ye,{modelValue:I.value,"onUpdate:modelValue":[t[0]||(t[0]=o=>I.value=o),c],dense:""},{default:a(()=>[r(k,{name:"api",label:"API Guide"}),r(k,{name:"licenses",label:"Open Source Licenses"})]),_:1},8,["modelValue"])]))}},ve=X({name:"QSlideTransition",props:{appear:Boolean,duration:{type:Number,default:300}},emits:["show","hide"],setup(e,{slots:O,emit:m}){let T=!1,I,c,n=null,t=null,o,S;function f(){I?.(),I=null,T=!1,n!==null&&(clearTimeout(n),n=null),t!==null&&(clearTimeout(t),t=null),c?.removeEventListener("transitionend",o),o=null}function E(s,R,N){R!==void 0&&(s.style.height=`${R}px`),s.style.transition=`height ${e.duration}ms cubic-bezier(.25, .8, .50, 1)`,T=!0,I=N}function g(s,R){s.style.overflowY=null,s.style.height=null,s.style.transition=null,f(),R!==S&&m(R)}function M(s,R){let N=0;c=s,T===!0?(f(),N=s.offsetHeight===s.scrollHeight?0:void 0):(S="hide",s.style.overflowY="hidden"),E(s,N,R),n=setTimeout(()=>{n=null,s.style.height=`${s.scrollHeight}px`,o=h=>{t=null,(Object(h)!==h||h.target===s)&&g(s,"show")},s.addEventListener("transitionend",o),t=setTimeout(o,e.duration*1.1)},100)}function v(s,R){let N;c=s,T===!0?f():(S="show",s.style.overflowY="hidden",N=s.scrollHeight),E(s,N,R),n=setTimeout(()=>{n=null,s.style.height=0,o=h=>{t=null,(Object(h)!==h||h.target===s)&&g(s,"hide")},s.addEventListener("transitionend",o),t=setTimeout(o,e.duration*1.1)},100)}return J(()=>{T===!0&&f()}),()=>d(de,{css:!1,appear:e.appear,onEnter:M,onLeave:v},O.default)}}),H=Ie({}),Pe=Object.keys(z),We=X({name:"QExpansionItem",props:{...z,...Ee,...ue,icon:String,label:String,labelLines:[Number,String],caption:String,captionLines:[Number,String],dense:Boolean,toggleAriaLabel:String,expandIcon:String,expandedIcon:String,expandIconClass:[Array,String,Object],duration:{},headerInsetLevel:Number,contentInsetLevel:Number,expandSeparator:Boolean,defaultOpened:Boolean,hideExpandIcon:Boolean,expandIconToggle:Boolean,switchToggleSide:Boolean,denseToggle:Boolean,group:String,popup:Boolean,headerStyle:[Array,String,Object],headerClass:[Array,String,Object]},emits:[...Oe,"click","afterShow","afterHide"],setup(e,{slots:O,emit:m}){const{proxy:{$q:T}}=Re(),I=pe(e,T),c=D(e.modelValue!==null?e.modelValue:e.defaultOpened),n=D(null),t=me(),{show:o,hide:S,toggle:f}=Ne({showing:c});let E,g;const M=u(()=>`q-expansion-item q-item-type q-expansion-item--${c.value===!0?"expanded":"collapsed"} q-expansion-item--${e.popup===!0?"popup":"standard"}`),v=u(()=>e.contentInsetLevel===void 0?null:{["padding"+(T.lang.rtl===!0?"Right":"Left")]:e.contentInsetLevel*56+"px"}),s=u(()=>e.disable!==!0&&(e.href!==void 0||e.to!==void 0&&e.to!==null&&e.to!=="")),R=u(()=>{const i={};return Pe.forEach(A=>{i[A]=e[A]}),i}),N=u(()=>s.value===!0||e.expandIconToggle!==!0),h=u(()=>e.expandedIcon!==void 0&&c.value===!0?e.expandedIcon:e.expandIcon||T.iconSet.expansionItem[e.denseToggle===!0?"denseIcon":"icon"]),Z=u(()=>e.disable!==!0&&(s.value===!0||e.expandIconToggle===!0)),ee=u(()=>({expanded:c.value===!0,detailsId:t.value,toggle:f,show:o,hide:S})),Y=u(()=>{const i=e.toggleAriaLabel!==void 0?e.toggleAriaLabel:T.lang.label[c.value===!0?"collapse":"expand"](e.label);return{role:"button","aria-expanded":c.value===!0?"true":"false","aria-controls":t.value,"aria-label":i}});P(()=>e.group,i=>{g?.(),i!==void 0&&_()});function te(i){s.value!==!0&&f(i),m("click",i)}function oe(i){i.keyCode===13&&B(i,!0)}function B(i,A){A!==!0&&i.qAvoidFocus!==!0&&n.value?.focus(),f(i),ge(i)}function ie(){m("afterShow")}function ne(){m("afterHide")}function _(){E===void 0&&(E=he()),c.value===!0&&(H[e.group]=E);const i=P(c,F=>{F===!0?H[e.group]=E:H[e.group]===E&&delete H[e.group]}),A=P(()=>H[e.group],(F,ce)=>{ce===E&&F!==void 0&&F!==E&&S()});g=()=>{i(),A(),H[e.group]===E&&delete H[e.group],g=void 0}}function se(){const i={class:[`q-focusable relative-position cursor-pointer${e.denseToggle===!0&&e.switchToggleSide===!0?" items-end":""}`,e.expandIconClass],side:e.switchToggleSide!==!0,avatar:e.switchToggleSide},A=[d(G,{class:"q-expansion-item__toggle-icon"+(e.expandedIcon===void 0&&c.value===!0?" q-expansion-item__toggle-icon--rotated":""),name:h.value})];return Z.value===!0&&(Object.assign(i,{tabindex:0,...Y.value,onClick:B,onKeyup:oe}),A.unshift(d("div",{ref:n,class:"q-expansion-item__toggle-focus q-icon q-focus-helper q-focus-helper--rounded",tabindex:-1}))),d(U,i,()=>A)}function ae(){let i;return O.header!==void 0?i=[].concat(O.header(ee.value)):(i=[d(U,()=>[d($,{lines:e.labelLines},()=>e.label||""),e.caption?d($,{lines:e.captionLines,caption:!0},()=>e.caption):null])],e.icon&&i[e.switchToggleSide===!0?"push":"unshift"](d(U,{side:e.switchToggleSide===!0,avatar:e.switchToggleSide!==!0},()=>d(G,{name:e.icon})))),e.disable!==!0&&e.hideExpandIcon!==!0&&i[e.switchToggleSide===!0?"unshift":"push"](se()),i}function re(){const i={ref:"item",style:e.headerStyle,class:e.headerClass,dark:I.value,disable:e.disable,dense:e.dense,insetLevel:e.headerInsetLevel};return N.value===!0&&(i.clickable=!0,i.onClick=te,Object.assign(i,s.value===!0?R.value:Y.value)),d(we,i,ae)}function le(){return Ae(d("div",{key:"e-content",class:"q-expansion-item__content relative-position",style:v.value,id:t.value},fe(O.default)),[[Se,c.value]])}function Te(){const i=[re(),d(ve,{duration:e.duration,onShow:ie,onHide:ne},le)];return e.expandSeparator===!0&&i.push(d(j,{class:"q-expansion-item__border q-expansion-item__border--top absolute-top",dark:I.value}),d(j,{class:"q-expansion-item__border q-expansion-item__border--bottom absolute-bottom",dark:I.value})),i}return e.group!==void 0&&_(),J(()=>{g?.()}),()=>d("div",{class:M.value},[d("div",{class:"q-expansion-item__container relative-position"},Te())])}}),K={backend:[{name:"Electron",version:"^36.5.0",license:"MIT",description:"크로스 플랫폼 데스크톱 애플리케이션 프레임워크",repository:"https://github.com/electron/electron",licenseText:`MIT License

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
THE SOFTWARE.`}]},Q={commands:[{name:"play",description:"현재 미디어 재생",simple:"play",json:'{"command": "play"}',params:[]},{name:"pause",description:"일시정지",simple:"pause",json:'{"command": "pause"}',params:[]},{name:"stop",description:"정지",simple:"stop",json:'{"command": "stop"}',params:[]},{name:"playfile",description:"파일명으로 재생",simple:"playfile,video.mp4",json:'{"command": "playfile", "file": "video.mp4"}',params:[{name:"file",type:"string",required:!0,description:"파일명"}]},{name:"playid",description:"ID(숫자) 또는 UUID(문자열)로 파일 재생",simple:"playid,123",json:'{"command": "playid", "id": 123}',params:[{name:"id",type:"string|number",required:!0,description:"파일 ID(숫자) 또는 UUID(문자열)"}]},{name:"next",description:"다음 트랙으로 이동",simple:"next",json:'{"command": "next"}',params:[]},{name:"prev",description:"이전 트랙으로 이동",simple:"prev",json:'{"command": "prev"}',params:[]},{name:"updatetime",description:"재생 시간 변경 (밀리초)",simple:"updatetime,30000",json:'{"command": "updatetime", "time": 30000}',params:[{name:"time",type:"number",required:!0,description:"재생 시간(밀리초)"}]},{name:"fullscreen",description:"전체화면 토글 또는 설정",simple:"fullscreen",json:'{"command": "fullscreen", "fullscreen": true}',params:[{name:"fullscreen",type:"boolean",required:!1,description:"전체화면 여부 (생략 시 토글)"}]},{name:"togglefullscreen",description:"전체화면 토글",simple:"togglefullscreen",json:'{"command": "togglefullscreen"}',params:[]},{name:"setrepeat",description:"반복 모드 설정 (none, all, repeat_one). 플레이리스트 모드가 아닐 때는 repeat_one 사용 불가",simple:"setrepeat,all",json:'{"command": "setrepeat", "mode": "all"}',params:[{name:"mode",type:"string",required:!1,description:"반복 모드 (none/all/repeat_one, 생략 시 다음 모드로 토글)"}]},{name:"getrepeat",description:"현재 반복 모드 조회",simple:"getrepeat",json:'{"command": "getrepeat"}',params:[]},{name:"getaudiodevices",description:"사용 가능한 오디오 장치 목록 조회",simple:"getaudiodevices",json:'{"command": "getaudiodevices"}',params:[]},{name:"getaudiodevice",description:"현재 오디오 장치 조회",simple:"getaudiodevice",json:'{"command": "getaudiodevice"}',params:[]},{name:"setaudiodevice",description:"오디오 장치 설정",simple:"setaudiodevice,스피커",json:'{"command": "setaudiodevice", "device": "스피커"}',params:[{name:"device",type:"string",required:!0,description:"설정할 오디오 장치명"}]},{name:"playlistplay",description:"플레이리스트 재생 (ID와 시작 트랙 번호)",simple:"playlistplay,1,2",json:'{"command": "playlistplay", "id": 1, "track": 2}',params:[{name:"id",type:"number",required:!0,description:"플레이리스트 ID"},{name:"track",type:"number",required:!1,description:"시작 트랙 인덱스 (기본값: 0)"}]},{name:"getfiles",description:"모든 파일 목록 조회",simple:"getfiles",json:'{"command": "getfiles"}',params:[]},{name:"getplaylists",description:"모든 플레이리스트 목록 조회 (간소화된 트랙 정보 포함: uuid, filename, time, mimetype, duration, trackId)",simple:"getplaylists",json:'{"command": "getplaylists"}',params:[]},{name:"getplaylist",description:"특정 플레이리스트 조회 (간소화된 트랙 정보 포함: uuid, filename, time, mimetype, duration, trackId)",simple:"getplaylist,1",json:'{"command": "getplaylist", "id": 1}',params:[{name:"id",type:"number",required:!0,description:"플레이리스트 ID"}]},{name:"startonplay",description:"부팅 시 자동 재생 설정 (enabled와 playlistId 지정)",simple:"startonplay,true,1",json:'{"command": "startonplay", "enabled": true, "playlistId": 1}',params:[{name:"enabled",type:"boolean",required:!1,description:"자동 재생 활성화 여부 (생략 시 현재 설정 조회)"},{name:"playlistId",type:"number",required:!1,description:"재생할 플레이리스트 ID (enabled가 true일 때만)"}]},{name:"setstartonplay",description:"startonplay의 별칭 (동일한 기능)",simple:"setstartonplay,true,1",json:'{"command": "setstartonplay", "enabled": true, "playlistId": 1}',params:[{name:"enabled",type:"boolean",required:!1,description:"자동 재생 활성화 여부"},{name:"playlistId",type:"number",required:!1,description:"재생할 플레이리스트 ID"}]},{name:"getstartonplay",description:"현재 부팅 시 자동 재생 설정 조회",simple:"getstartonplay",json:'{"command": "getstartonplay"}',params:[]}]},Ue={key:0},Ge=["innerHTML"],xe=["innerHTML"],Ye=["innerHTML"],Be=["innerHTML"],_e=["innerHTML"],je=["innerHTML"],Ve={key:1,class:"licenses-section"},ke={class:"text-body2 q-mb-md"},qe=["href"],$e={class:"license-text q-mt-sm"},Ke={__name:"helpContent",props:{currentTab:{type:String,default:"api"}},setup(e){const O=e,m=u(()=>Q.commands.filter(n=>n.simple).map(n=>({command:n.name,description:n.description,parameters:n.params.map(t=>`${t.name} (${t.type}, ${t.required?"필수":"선택"}): ${t.description}`).join(", ")||"",example:n.simple}))),T=[{name:"command",label:"Command",field:"command",align:"left"},{name:"description",label:"Description",field:"description",align:"left"},{name:"parameters",label:"Parameters",field:"parameters",align:"left"},{name:"example",label:"Example",field:"example",align:"left"}],I=u(()=>Q.commands.filter(n=>n.json).map(n=>({command:n.name,description:n.description,parameters:n.params.map(t=>`${t.name} (${t.type}, ${t.required?"필수":"선택"}): ${t.description}`).join(", ")||"",response:"",example:n.json}))),c=u(()=>{const n=K.backend?.map(o=>({...o,type:"Backend"}))||[],t=K.frontend?.map(o=>({...o,type:"Frontend"}))||[];return[...n,...t]});return(n,t)=>(b(),V(x,{class:"q-px-md",flat:""},{default:a(()=>[O.currentTab==="api"?(b(),C("div",Ue,[r(p,null,{default:a(()=>t[0]||(t[0]=[l("div",{class:"text-bold"},"Terminal Commands(Simple)",-1)])),_:1,__:[0]}),r(p,null,{default:a(()=>[r(q,{dense:"",rows:m.value,columns:T,"row-key":"command",flat:"",pagination:{rowsPerPage:0,page:1},"hide-bottom":"","no-data-label":"No commands available"},{"body-cell-description":a(o=>[r(y,{props:o,class:"pre-wrap-cell"},{default:a(()=>[l("div",{innerHTML:L(w)(o.row.description)},null,8,Ge)]),_:2},1032,["props"])]),"body-cell-parameters":a(o=>[r(y,{props:o,class:"pre-wrap-cell"},{default:a(()=>[l("div",{innerHTML:L(w)(o.row.parameters)},null,8,xe)]),_:2},1032,["props"])]),"body-cell-example":a(o=>[r(y,{props:o,class:"pre-wrap-cell"},{default:a(()=>[l("div",{innerHTML:L(w)(o.row.example)},null,8,Ye)]),_:2},1032,["props"])]),_:1},8,["rows"])]),_:1}),r(p,null,{default:a(()=>t[1]||(t[1]=[l("div",{class:"text-caption"}," Use these commands to control the video player via TCP connection. Each command can be sent as a simple string. ",-1)])),_:1,__:[1]}),r(p,null,{default:a(()=>t[2]||(t[2]=[l("div",{class:"text-h6"},"Terminal Commands(JSON)",-1)])),_:1,__:[2]}),r(p,null,{default:a(()=>[r(q,{dense:"",rows:I.value,columns:T,"row-key":"command",flat:"",pagination:{rowsPerPage:0,page:1},"hide-bottom":"","no-data-label":"No commands available"},{"body-cell-description":a(o=>[r(y,{props:o,class:"pre-wrap-cell"},{default:a(()=>[l("div",{innerHTML:L(w)(o.row.description)},null,8,Be)]),_:2},1032,["props"])]),"body-cell-parameters":a(o=>[r(y,{props:o,class:"pre-wrap-cell"},{default:a(()=>[l("div",{innerHTML:L(w)(o.row.parameters)},null,8,_e)]),_:2},1032,["props"])]),"body-cell-example":a(o=>[r(y,{props:o,class:"pre-wrap-cell"},{default:a(()=>[l("div",{innerHTML:L(w)(o.row.example)},null,8,je)]),_:2},1032,["props"])]),_:1},8,["rows"])]),_:1}),r(p,null,{default:a(()=>t[3]||(t[3]=[l("div",{class:"text-caption"}," Use these commands to interact with the video player via TCP connection. Each command can be sent as a JSON object. ",-1)])),_:1,__:[3]})])):e.currentTab==="licenses"?(b(),C("div",Ve,[r(p,null,{default:a(()=>t[4]||(t[4]=[l("div",{class:"text-h5 q-mb-md"},"Open Source Licenses",-1),l("div",{class:"text-body2 text-grey-7"}," 이 프로젝트는 다음의 오픈소스 라이브러리를 사용합니다. ",-1)])),_:1,__:[4]}),r(p,null,{default:a(()=>[(b(!0),C(be,null,Le(c.value,(o,S)=>(b(),V(We,{key:`license-${S}`,label:o.name,caption:`${o.version} - ${o.license} (${o.type})`,class:"q-mb-sm","header-class":"bg-grey-2"},{default:a(()=>[r(x,null,{default:a(()=>[r(p,null,{default:a(()=>[t[5]||(t[5]=l("div",{class:"text-subtitle2"},"Description",-1)),l("div",ke,W(o.description),1),t[6]||(t[6]=l("div",{class:"text-subtitle2"},"Repository",-1)),l("a",{href:o.repository,target:"_blank",class:"text-primary q-mb-md"},W(o.repository),9,qe),t[7]||(t[7]=l("div",{class:"text-subtitle2 q-mt-md"},"License Text",-1)),l("pre",$e,W(o.licenseText),1)]),_:2,__:[5,6,7]},1024)]),_:2},1024)]),_:2},1032,["label","caption"]))),128))]),_:1})])):He("",!0)]),_:1}))}},Qe=Ce(Ke,[["__scopeId","data-v-a9eff02c"]]),Xe={class:"q-pa-md"},Tt={__name:"HelpPage",setup(e){const O=D("api");return(m,T)=>(b(),C("div",Xe,[r(x,{flat:""},{default:a(()=>[r(p,{class:"q-py-none"},{default:a(()=>[r(Me,{modelValue:O.value,"onUpdate:modelValue":T[0]||(T[0]=I=>O.value=I)},null,8,["modelValue"])]),_:1}),r(p,{class:"q-py-xs"},{default:a(()=>[r(Qe,{"current-tab":O.value},null,8,["current-tab"])]),_:1})]),_:1})]))}};export{Tt as default};

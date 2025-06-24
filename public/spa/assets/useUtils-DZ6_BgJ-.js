const e=a=>{const t=Math.floor(Math.log(a)/Math.log(1024));return`${(a/Math.pow(1024,t)).toFixed(2)} ${["B","KB","MB","GB"][t]}`},o=a=>a.charAt(0).toUpperCase()+a.slice(1);export{o as f,e as h};

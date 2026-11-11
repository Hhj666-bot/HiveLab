export type CastLayout={slot:number;height:number;gap:number;padding:number};
/** Fits the standees to the width of the home stage. */
export function castLayout(width:number,stageHeight:number,count:number,density:number):CastLayout{
 const figures=Math.max(1,count),padding=Math.min(64,Math.max(20,width*.035)),gap=Math.round(8*density);
 const slot=Math.max(100,Math.min(300,((width-padding*2-gap*(figures-1))/figures)*density));
 return {slot,height:Math.min(480,stageHeight,slot*2.8+90),gap,padding};
}
/** Where a standee's middle stands in a layout, from the middle of the width that holds it. A cast too wide to
 *  fit starts at the edge instead. */
export function castMiddle(layout:CastLayout,width:number,count:number,index:number){
 const step=layout.slot+layout.gap,total=layout.padding*2+layout.slot*count+layout.gap*(count-1);
 return total<=width?(index-(count-1)/2)*step:layout.padding+layout.slot/2+index*step-width/2;
}

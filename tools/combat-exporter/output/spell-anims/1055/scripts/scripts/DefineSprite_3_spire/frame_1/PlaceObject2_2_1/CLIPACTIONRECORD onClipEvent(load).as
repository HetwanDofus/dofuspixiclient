onClipEvent(load){
   va = 1 + random(2.5);
   _alpha = 50 + random(50);
   _yscale = 80;
   _xscale = 80 + random(80);
   v = 0.67 + 1.67 * Math.random();
   if(_parent.c % 2 == 0)
   {
      gotoAndStop(2);
   }
   else
   {
      gotoAndStop(1);
   }
}

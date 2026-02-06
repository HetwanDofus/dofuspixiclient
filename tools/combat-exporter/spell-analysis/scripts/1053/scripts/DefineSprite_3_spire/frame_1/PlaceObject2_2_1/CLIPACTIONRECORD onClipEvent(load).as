onClipEvent(load){
   va = 1.5 + random(5);
   _alpha = 50 + random(50);
   _xscale = 200;
   _yscale = 80 + random(40);
   v = 1 + 2.5 * Math.random();
   if(_parent.c % 2 == 0)
   {
      gotoAndStop(2);
   }
   else
   {
      gotoAndStop(1);
   }
}

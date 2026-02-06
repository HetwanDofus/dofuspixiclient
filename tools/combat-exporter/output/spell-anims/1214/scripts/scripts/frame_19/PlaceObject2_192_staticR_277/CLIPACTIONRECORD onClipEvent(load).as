onClipEvent(load){
   d = 53;
   if(_parent.angle < 0)
   {
      this.swapDepths(5);
      dy = (- d) / 2;
   }
   else
   {
      this.swapDepths(15);
      dy = d / 2;
   }
   if(Math.abs(_parent.angle) > 90)
   {
      dx = - d;
   }
   else
   {
      dx = d;
   }
   _X = _parent.cellTo.x + dx;
   _Y = _parent.cellTo.y + dy;
}

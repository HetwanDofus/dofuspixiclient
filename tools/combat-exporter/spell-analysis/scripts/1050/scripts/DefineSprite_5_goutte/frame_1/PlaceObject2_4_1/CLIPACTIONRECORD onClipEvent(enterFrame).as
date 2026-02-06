onClipEvent(enterFrame){
   if(_Y < 0)
   {
      f += g;
      _Y = _Y + f;
   }
   else if(fin != 1)
   {
      play();
      fin = 1;
      _parent.vx = 0;
      _parent.vy = 0;
   }
}

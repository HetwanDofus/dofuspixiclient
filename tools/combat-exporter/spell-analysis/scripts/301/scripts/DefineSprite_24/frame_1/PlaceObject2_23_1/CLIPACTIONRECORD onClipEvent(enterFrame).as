onClipEvent(enterFrame){
   if(_Y > -80 & _parent._alpha < 100)
   {
      _parent._alpha += 6;
   }
   if(_Y < -80)
   {
      _parent._alpha -= 6;
      if(_parent._alpha < 0)
      {
         _parent._visible = 0;
         st = 1;
         _parent.removeMovieClip();
      }
   }
   _rotation = _rotation + 1.3;
   _Y = 5 * Math.cos(i) + (p -= v);
   _X = 25 * Math.sin(i += v2);
   if(Math.cos(i) < 0)
   {
      _alpha = 80 * Math.cos(i) + 100;
   }
}

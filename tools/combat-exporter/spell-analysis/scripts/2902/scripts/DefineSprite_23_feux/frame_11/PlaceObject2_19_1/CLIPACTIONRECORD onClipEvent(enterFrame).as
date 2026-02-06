onClipEvent(enterFrame){
   if(t < 150)
   {
      play();
   }
   if(t < 135)
   {
      nbr = 1;
      while(nbr < 10)
      {
         compte = random(200000);
         _parent._parent.attachMovie("minifeux3","minifeux3" + compte,compte);
         eval("_parent._parent.minifeux3" + compte)._x = _X;
         eval("_parent._parent.minifeux3" + compte)._y = _Y + _parent._y;
         eval("_parent._parent.minifeux3" + compte)._alpha = 100 - c++;
         nbr++;
      }
      _parent.removeMovieClip();
   }
   _rotation = _rotation + t / 3;
   t--;
   _xscale = t / 3;
   _yscale = t / 3;
   _parent._y += g;
   _X = _X + (vx *= accx);
   _Y = _Y + (vy *= accy);
   if(t < 0)
   {
   }
}

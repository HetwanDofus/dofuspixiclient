onClipEvent(enterFrame){
   _rotation = angle * 57.29746936176985;
   _alpha = 50 + random(60);
   sz *= frein + 0.02;
   _xscale = sz;
   _yscale = sz;
   if(random(16) == 1)
   {
      vr = 1 * (-0.5 + Math.random());
   }
   angle += vr * frangle;
   frangle *= frein;
   vx = vit * Math.cos(angle);
   vy = vit * Math.sin(angle);
   _X = _X + vx;
   _Y = _Y + vy;
   vit *= frein;
   if(t < 100)
   {
      play();
   }
   if(t < 90)
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
}

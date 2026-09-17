// modules/education/education.module.ts
// Education (PRD M09, §9.9) — the agri-learning library. Two layers:
//  (A) COURSES — instructors author courses (draft→review→published↔paused→archived) with lessons; learners
//      enroll (free = instant; paid = a ZERO-SUM wallet purchase splitting price into instructor royalty
//      (default 80%) + platform Fees, Law 2) and track lesson progress → completion.
//  (B) CREATOR CONTENT — anyone with channel.host registers an external content channel (YouTube/other), which
//      a tenant moderator (content.moderate) APPROVES before it can publish curated resources (video/blog/post)
//      or host LIVE streaming sessions (external stream provider, resilience-wrapped). Self-service hosting,
//      admin-gated. A new live session/approved resource emits events the notification spine can fan out.
// Gated by the `education` flag (default OFF).
// DEFERRED: certificate (PDF) issuance on completion; online payment-intent enrol path (wallet is the path);
// instructor payout aggregation jobs; quiz auto-grading; external-metadata fetch + recording retrieval.
import { Module } from '@nestjs/common';
import { InstructorsController } from './controllers/v1/instructors.controller';
import { CoursesController } from './controllers/v1/courses.controller';
import { LessonsController } from './controllers/v1/lessons.controller';
import { EnrollmentsController } from './controllers/v1/enrollments.controller';
import { ChannelsController } from './controllers/v1/channels.controller';
import { ResourcesController } from './controllers/v1/resources.controller';
import { LiveSessionsController } from './controllers/v1/live-sessions.controller';
import { InstructorService } from './services/instructor.service';
import { CourseService } from './services/course.service';
import { LessonService } from './services/lesson.service';
import { EnrollmentService } from './services/enrollment.service';
import { LessonProgressService } from './services/lesson-progress.service';
import { LearningChannelService } from './services/learning-channel.service';
import { LearningResourceService } from './services/learning-resource.service';
import { LiveSessionService } from './services/live-session.service';
import { InstructorRepository } from './repositories/instructor.repository';
import { CourseRepository } from './repositories/course.repository';
import { CourseLessonRepository } from './repositories/course-lesson.repository';
import { EnrollmentRepository } from './repositories/enrollment.repository';
import { LessonProgressRepository } from './repositories/lesson-progress.repository';
import { LearningChannelRepository } from './repositories/learning-channel.repository';
import { LearningResourceRepository } from './repositories/learning-resource.repository';
import { LiveSessionRepository } from './repositories/live-session.repository';
import { CropCalendarReadModel } from './read-models/crop-calendar.read-model';
import { streamProviderProvider } from './gateway/stream.provider';

@Module({
  controllers: [InstructorsController, CoursesController, LessonsController, EnrollmentsController, ChannelsController, ResourcesController, LiveSessionsController],
  providers: [
    InstructorService, CourseService, LessonService, EnrollmentService, LessonProgressService,
    LearningChannelService, LearningResourceService, LiveSessionService,
    InstructorRepository, CourseRepository, CourseLessonRepository, EnrollmentRepository, LessonProgressRepository,
    LearningChannelRepository, LearningResourceRepository, LiveSessionRepository,
    CropCalendarReadModel,
    streamProviderProvider,
  ],
  exports: [CourseService, LessonService, EnrollmentService, LearningChannelService, LiveSessionService],
})
export class EducationModule {}
